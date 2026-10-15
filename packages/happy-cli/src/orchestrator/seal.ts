import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';

import { configuration } from '@/configuration';
import { decodeBase64, decrypt, encodeBase64, encryptWithDataKey, decryptWithDataKey } from '@/api/encryption';
import { readSettings, type Credentials } from '@/persistence';
import { deriveKey } from '@/utils/deriveKey';
import type { OrchestratorOutputFile, OrchestratorProvider, OrchestratorTransferResult } from '@/orchestrator/common';

/**
 * End-to-end encryption of orchestrator tasks. Every machine and app of the account holds the
 * account's orchestrator key; the server holds none. A session seals what a task is to do into
 * an envelope, the daemon that runs it opens it and goes by it rather than by what the server
 * says, and seals what the task produced. The server only stores and passes on sealed values: it
 * can neither read them nor make up a task a daemon would run.
 *
 * What stays in plaintext, for the server to schedule by: task keys and dependencies, provider and
 * model, timeouts, retry counts, statuses, exit codes, machine and session ids. A follow-up is
 * bound to its task, not to the task's child session. Voice is not covered.
 */

// What the server takes as sealed: this prefix and the base64 of an AES-256-GCM bundle
const SEALED_PREFIX = 'e2e1:';
// An envelope this old is refused: the replay guard forgets the envelopes it saw by then
const ENVELOPE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** What every task envelope holds: an id for the replay guard, and the machines it may run on */
type EnvelopeBase = {
    sealId: string;
    createdAt: number;
    /** 'all': any of the account's machines (exec and transfer to all_online) */
    machineIds: string[] | 'all';
    /** How many executions (the first and its retries) may run it */
    maxAttempts: number;
};

export type OrchestratorTaskEnvelope =
    | EnvelopeBase & { kind: 'task'; provider: OrchestratorProvider; model?: string; prompt: string; workingDirectory?: string }
    | EnvelopeBase & { kind: 'shell'; command: string; workingDirectory?: string }
    | EnvelopeBase & { kind: 'transfer'; sourceMachineId: string; sourcePath: string; targetPath: string; overwrite: boolean };

/** A follow-up to a finished task (orchestrator_send_message), run once */
export type OrchestratorResumeEnvelope = { kind: 'resume'; sealId: string; taskId: string; message: string; createdAt: number };

/** A run's or task's title, with what the controller attached to it */
export type OrchestratorSealedTitle = { title: string; metadata?: Record<string, unknown> };

/** What an execution produced, sealed by the daemon that ran it */
export type OrchestratorSealedResult = {
    kind: 'result';
    taskId: string;
    executionId: string;
    outputSummary?: string | null;
    outputText?: string | null;
    stderrText?: string | null;
    stdoutFile?: OrchestratorOutputFile | null;
    stderrFile?: OrchestratorOutputFile | null;
    transferResult?: OrchestratorTransferResult | null;
    errorMessage?: string | null;
};

/** A transfer end's X25519 public key, sealed so the server cannot put its own in between */
export type OrchestratorTransferKey = { kind: 'transfer-key'; executionId: string; publicKey: string; role: 'source' | 'target' };

// Shown for what the account's orchestrator key does not open (sealed with another, or altered)
const UNREADABLE = '[cannot be decrypted with the orchestrator key]';

function isSealed(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(SEALED_PREFIX);
}

export function sealOrchestrator(value: unknown, key: Uint8Array): string {
    return SEALED_PREFIX + encodeBase64(encryptWithDataKey(value, key));
}

/** The value sealed in `sealed`; null when it is not sealed or not with this key */
export function openOrchestrator<T>(sealed: unknown, key: Uint8Array): T | null {
    if (!isSealed(sealed)) {
        return null;
    }
    try {
        return decryptWithDataKey(decodeBase64(sealed.slice(SEALED_PREFIX.length)), key) as T | null;
    } catch {
        return null;
    }
}

/** A sealed title opened; one from before titles were sealed as it is */
export function openOrchestratorTitle(title: unknown, key: Uint8Array): unknown {
    return isSealed(title) ? openOrchestrator<OrchestratorSealedTitle>(title, key)?.title ?? UNREADABLE : title;
}

// What a task's envelope says, in the fields the task was shown with before it was sealed: a
// transfer as exec and transfer list it (with its result) has from and to instead of a prompt
function openPrompt(task: Record<string, any>, key: Uint8Array): Record<string, unknown> {
    if (!isSealed(task.prompt)) {
        return {};
    }
    const envelope = openOrchestrator<OrchestratorTaskEnvelope>(task.prompt, key);
    switch (envelope?.kind) {
        case 'task':
            return { prompt: envelope.prompt, workingDirectory: envelope.workingDirectory ?? null };
        case 'shell':
            return { prompt: envelope.command, workingDirectory: envelope.workingDirectory ?? null };
        case 'transfer': {
            const { sourceMachineId, sourcePath, targetPath, overwrite } = envelope;
            return 'result' in task
                ? { prompt: undefined, from: { machineId: sourceMachineId, path: sourcePath }, to: targetPath }
                : { prompt: JSON.stringify({ sourceMachineId, sourcePath, targetPath, overwrite }), workingDirectory: null };
        }
        default:
            return { prompt: UNREADABLE };
    }
}

// A task's or execution's sealed result opened into the fields it has: outputText for a task as
// runs show it, stdout for a shell task as exec shows it, result for a transfer. A result sealed
// for another task or execution (moved there by the server) does not open.
function openResult(target: Record<string, any>, key: Uint8Array, taskId: unknown, executionId?: unknown): Record<string, any> {
    const { sealedResult, ...rest } = target;
    if (!sealedResult) {
        return rest;
    }
    const result = openOrchestrator<OrchestratorSealedResult>(sealedResult, key);
    if (result?.kind !== 'result' || result.taskId !== taskId || (executionId !== undefined && result.executionId !== executionId)) {
        return { ...rest, errorMessage: `Result ${UNREADABLE}` };
    }
    const fields: Record<string, unknown> = {
        outputSummary: result.outputSummary,
        outputText: result.outputText,
        stderrText: result.stderrText,
        stdout: result.outputText,
        stderr: result.stderrText,
        stdoutFile: result.stdoutFile,
        stderrFile: result.stderrFile,
        result: result.transferResult,
    };
    return {
        ...rest,
        ...Object.fromEntries(Object.entries(fields).filter(([name]) => name in rest)),
        errorMessage: result.errorMessage ?? rest.errorMessage,
    };
}

function openTask(task: Record<string, any>, key: Uint8Array): Record<string, any> {
    return {
        ...openResult({ ...task, ...openPrompt(task, key) }, key, task.taskId),
        ...('title' in task ? { title: openOrchestratorTitle(task.title, key) } : {}),
        ...(Array.isArray(task.executions) ? {
            executions: task.executions.map((execution: Record<string, any>) => openResult({
                ...execution,
                resumeMessage: isSealed(execution.resumeMessage)
                    ? openOrchestrator<OrchestratorResumeEnvelope>(execution.resumeMessage, key)?.message ?? UNREADABLE
                    : execution.resumeMessage,
            }, key, task.taskId, execution.executionId)),
        } : {}),
    };
}

/**
 * An orchestrator response (`{ ok, data }`) with what is sealed in it opened, in the shape it had
 * before tasks were sealed: run and task titles, what tasks do, their results and follow-ups.
 */
export function openOrchestratorResponse<T>(response: T, key: Uint8Array): T {
    const data = (response as any)?.data;
    if (!data || typeof data !== 'object') {
        return response;
    }
    return {
        ...response,
        data: {
            ...data,
            ...('title' in data ? { title: openOrchestratorTitle(data.title, key) } : {}),
            ...(data.run && 'title' in data.run ? { run: { ...data.run, title: openOrchestratorTitle(data.run.title, key) } } : {}),
            ...(Array.isArray(data.tasks) ? { tasks: data.tasks.map((task: Record<string, any>) => openTask(task, key)) } : {}),
            ...(data.task ? { task: openTask(data.task, key) } : {}),
            ...(Array.isArray(data.items) ? { items: data.items.map((item: Record<string, any>) => ({ ...item, title: openOrchestratorTitle(item.title, key) })) } : {}),
        },
    } as T;
}

/** A title sealed for the server, with what the controller attaches to it */
export function sealTitle(title: string | undefined, metadata: Record<string, unknown> | undefined, key: Uint8Array): string | undefined {
    return title === undefined && metadata === undefined ? undefined : sealOrchestrator({ title: title ?? '', metadata }, key);
}

const keys = new Map<string, Promise<Uint8Array>>();

/**
 * The account's orchestrator key. A CLI signed in with the account's secret derives it, as the
 * app does; one signed in by the app has it from the app, sealed with this machine's key on its
 * machine record (the app puts it there when it next syncs machines).
 */
export function loadOrchestratorKey(credential: Credentials): Promise<Uint8Array> {
    const cacheKey = credential.token;
    const cached = keys.get(cacheKey);
    if (cached) {
        return cached;
    }
    const loading = (async () => {
        if (credential.encryption.type === 'legacy') {
            return deriveKey(credential.encryption.secret, 'Happy Orchestrator', ['key']);
        }
        const { machineId } = await readSettings();
        const response = await axios.get(`${configuration.serverUrl}/v1/machines/${encodeURIComponent(machineId ?? '')}`, {
            headers: { 'Authorization': `Bearer ${credential.token}` },
            timeout: 30_000,
        });
        const sealed: string | null | undefined = response.data?.machine?.orchestratorKey;
        const opened = sealed ? decrypt(credential.encryption.machineKey, 'dataKey', decodeBase64(sealed)) as { key?: string } | null : null;
        const key = typeof opened?.key === 'string' ? decodeBase64(opened.key) : null;
        if (!key || key.length !== 32) {
            throw new Error('This machine has not received the orchestrator key yet: open the Happy app on your phone or computer so it can hand the key over, then try again');
        }
        return key;
    })();
    keys.set(cacheKey, loading);
    // Not cached when it failed: the app may hand the key over any time
    loading.catch(() => keys.delete(cacheKey));
    return loading;
}

type SeenSeals = Record<string, { createdAt: number; executionIds: string[] }>;

/**
 * Opens the tasks the server dispatches to this machine, refusing what it should not run: an
 * envelope not sealed with the account's key, of another kind, for other machines, too old, or
 * run more often than its attempts allow. The envelopes seen are kept in a file, so a server
 * cannot replay one after the daemon restarts.
 */
export type OrchestratorEnvelopeOpener = ReturnType<typeof createOrchestratorEnvelopeOpener>;

export function createOrchestratorEnvelopeOpener(opts: {
    loadKey: () => Promise<Uint8Array>;
    machineId: string;
    seenFile?: string;
}) {
    const seenFile = opts.seenFile ?? join(configuration.happyHomeDir, 'orchestrator-seals.json');

    // Synchronous from reading to writing, so two dispatches cannot both take the last attempt
    const claim = (sealId: string, createdAt: number, executionId: string, limit: number) => {
        if (!(Date.now() - createdAt < ENVELOPE_MAX_AGE_MS)) {
            throw new Error('Orchestrator task refused: it was sealed too long ago');
        }
        let seen: SeenSeals = {};
        try {
            seen = existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, 'utf8')) : {};
        } catch {
            // A damaged file starts over; the age limit still bounds what can be replayed
        }
        const entry = seen[sealId] ?? { createdAt, executionIds: [] };
        if (!entry.executionIds.includes(executionId)) {
            if (entry.executionIds.length >= limit) {
                throw new Error('Orchestrator task refused: it already ran as often as it may');
            }
            entry.executionIds.push(executionId);
        }
        const kept = Object.fromEntries(Object.entries(seen).filter(([, value]) => Date.now() - value.createdAt < ENVELOPE_MAX_AGE_MS));
        kept[sealId] = entry;
        writeFileSync(`${seenFile}.tmp`, JSON.stringify(kept), { mode: 0o600 });
        renameSync(`${seenFile}.tmp`, seenFile);
    };

    return {
        /**
         * The envelope of a dispatched execution, and for a resume the follow-up message, once
         * both check out.
         */
        open: async <K extends OrchestratorTaskEnvelope['kind']>(kind: K, payload: {
            executionId: string;
            taskId: string;
            executionType?: 'initial' | 'resume';
            prompt: unknown;
            resumeMessage?: unknown;
        }): Promise<{ envelope: Extract<OrchestratorTaskEnvelope, { kind: K }>; resumeMessage: string | null }> => {
            const key = await opts.loadKey();
            const envelope = openOrchestrator<OrchestratorTaskEnvelope>(payload.prompt, key);
            if (envelope?.kind !== kind || typeof envelope.sealId !== 'string') {
                throw new Error('Orchestrator task refused: it is not sealed with the orchestrator key');
            }
            if (envelope.machineIds !== 'all' && !envelope.machineIds.includes(opts.machineId)) {
                throw new Error('Orchestrator task refused: it was not sent to this machine');
            }
            if (payload.executionType !== 'resume') {
                claim(envelope.sealId, envelope.createdAt, payload.executionId, envelope.maxAttempts);
                return { envelope: envelope as Extract<OrchestratorTaskEnvelope, { kind: K }>, resumeMessage: null };
            }
            const resume = openOrchestrator<OrchestratorResumeEnvelope>(payload.resumeMessage, key);
            if (resume?.kind !== 'resume' || resume.taskId !== payload.taskId || typeof resume.sealId !== 'string') {
                throw new Error('Orchestrator follow-up refused: it is not sealed with the orchestrator key for this task');
            }
            claim(resume.sealId, resume.createdAt, payload.executionId, 1);
            return { envelope: envelope as Extract<OrchestratorTaskEnvelope, { kind: K }>, resumeMessage: resume.message };
        },

        /** A transfer's envelope as its source machine gets it, once it checks out as from here */
        openSource: async (spec: unknown): Promise<Extract<OrchestratorTaskEnvelope, { kind: 'transfer' }>> => {
            const envelope = openOrchestrator<OrchestratorTaskEnvelope>(spec, await opts.loadKey());
            if (envelope?.kind !== 'transfer' || envelope.sourceMachineId !== opts.machineId) {
                throw new Error('Transfer refused: it is not sealed with the orchestrator key as one from this machine');
            }
            return envelope;
        },
    };
}
