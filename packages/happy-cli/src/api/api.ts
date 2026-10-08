import axios from 'axios'
import { loadExecutionCapability, saveExecutionCapability, type ExecutionCapability } from '@/orchestrator/executionCapability';
import { acquireFileLock } from '@/orchestrator/fileLock';
import { createHash } from 'node:crypto';
import { AiExecutionTemplateContextSchema, AiExecutionTemplateProposalInputSchema } from 'happy-wire';
import { join } from 'node:path';
import { acknowledgeApprovalFinish } from '@/orchestrator/approvalJournal';
import { verifyRegisteredRepo } from '@/orchestrator/registeredRepo';
import type { ProjectSnapshot } from '@/orchestrator/projectSnapshot';
import type { ExecutionEvent } from '@/orchestrator/eventQueue';
import type { UsageDelta } from '@/orchestrator/usageQueue';
import { identifyFixedLegacyOrigin } from '@/orchestrator/legacyOrigin';
import type { OrchestratorDispatchPayload } from '@/orchestrator/common';
import { logger } from '@/ui/logger'
import type { AgentState, CreateSessionResponse, Metadata, Session, Machine, MachineMetadata, DaemonState } from '@/api/types'
import { ApiSessionClient } from './apiSession';
import { ApiMachineClient } from './apiMachine';
import { decodeBase64, encodeBase64, getRandomBytes, encrypt, decrypt, libsodiumEncryptForPublicKey } from './encryption';
import { PushNotificationClient } from './pushNotifications';
import { configuration } from '@/configuration';
import chalk from 'chalk';
import { Credentials } from '@/persistence';
import { connectionState, isNetworkError } from '@/utils/serverConnectionErrors';

export class ApiClient {
  private executionCapabilityRoot: string | null = null;
  private approvalJournalRoot: string | null = null;

  setExecutionCapabilityRoot(root: string): void { this.executionCapabilityRoot = root; }
  setApprovalJournalRoot(root: string): void { this.approvalJournalRoot = root; }

  async keepExecutionCapabilityAlive(executionId: string): Promise<void> {
    await this.executionCapability(executionId, 'finish');
  }

  private async executionCapability(executionId: string, operation: string): Promise<string | null> {
    if (!this.executionCapabilityRoot) return null;
    const record = await loadExecutionCapability(this.executionCapabilityRoot, executionId);
    if (!record) return null;
    if (!record.capability.allowedOps.includes(operation))
      throw new Error('Execution capability does not allow operation');
    if (record.capability.recoveryMode === 'drain') {
      if (Date.parse(record.capability.expiresAt) <= Date.now())
        return this.recoverExpiredExecutionCapability(executionId, operation);
      return record.capability.token;
    }
    if (Date.parse(record.capability.expiresAt) - Date.now() < 120_000) {
      if (!this.machineIdForCapability) throw new Error('Execution capability machine unavailable');
      if (Date.parse(record.capability.expiresAt) <= Date.now())
        return this.recoverExpiredExecutionCapability(executionId, operation);
      const issued = await axios.post(`${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(executionId)}/capabilities/renew`,
        { machineId: this.machineIdForCapability, dispatchToken: record.dispatchToken,
          capability: record.capability.token },
        { headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 10_000 });
      const renewed = issued.data as ExecutionCapability;
      if (renewed.protocolVersion !== 1 || !/^[0-9a-f]{64}$/.test(renewed.token)
        || !Array.isArray(renewed.allowedOps)
        || [...renewed.allowedOps].sort().join('\0') !== [...record.capability.allowedOps].sort().join('\0')
        || Date.parse(renewed.expiresAt) <= Date.now())
        throw new Error('Execution capability renewal changed scope');
      await saveExecutionCapability(this.executionCapabilityRoot, executionId, record.dispatchToken, renewed);
      return renewed.token;
    }
    return record.capability.token;
  }

  private async recoverExpiredExecutionCapability(executionId: string, operation: string): Promise<string> {
    if (!this.executionCapabilityRoot || !this.machineIdForCapability
      || !['finish', 'event', 'usage'].includes(operation))
      throw new Error('Execution capability recovery is unavailable');
    const root = this.executionCapabilityRoot;
    const lock = await acquireFileLock(join(root, `${createHash('sha256').update(executionId).digest('hex')}.recovery.lock`), 15);
    try {
      const record = await loadExecutionCapability(root, executionId);
      if (!record) throw new Error('Execution capability recovery identity missing');
      if (record.capability.recoveryMode === 'drain') {
        if (Date.parse(record.capability.expiresAt) > Date.now()) return record.capability.token;
        if (!record.originalCapability || !record.recoveryId || !record.recoveryGeneration)
          throw new Error('Execution drain recovery proof unavailable');
      }
      if (record.capability.recoveryMode !== 'drain'
        && Date.parse(record.capability.expiresAt) > Date.now()) return record.capability.token;
      const base = `${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(executionId)}`;
      const headers = { Authorization: `Bearer ${this.credential.token}` };
      const body = { machineId: this.machineIdForCapability, dispatchToken: record.dispatchToken,
        expiredCapability: (record.originalCapability ?? record.capability).token };
      const request = await axios.post(`${base}/capabilities/recovery-requests`, body,
        { headers, timeout: 10_000 });
      const recovery = request.data as { id?: unknown; status?: unknown; expiresAt?: unknown; generation?: unknown };
      if (typeof recovery.id !== 'string' || !recovery.id
        || !Number.isSafeInteger(recovery.generation) || Number(recovery.generation) < 1
        || (record.recoveryId !== undefined && recovery.id !== record.recoveryId)
        || (record.recoveryGeneration !== undefined
          && Number(recovery.generation) <= record.recoveryGeneration)
        || (record.recoveryGeneration === undefined && recovery.generation !== 1)
        || !Number.isFinite(Date.parse(String(recovery.expiresAt)))
        || Date.parse(String(recovery.expiresAt)) <= Date.now()
        || !['pending', 'confirmed'].includes(String(recovery.status)))
        throw new Error('Execution capability recovery response changed');
      if (recovery.status === 'pending') throw new Error('EXECUTION_CAPABILITY_RECOVERY_PENDING');
      const claimed = await axios.post(`${configuration.serverUrl}/v1/ai-team/capability-recoveries/${encodeURIComponent(recovery.id)}/claim`,
        { executionId, ...body, generation: recovery.generation }, { headers, timeout: 10_000 });
      const capability = claimed.data as ExecutionCapability & { generation?: number };
      if (capability?.recoveryMode !== 'drain' || capability.protocolVersion !== 1
        || capability.generation !== recovery.generation
        || !/^[0-9a-f]{64}$/.test(capability.token)
        || !Array.isArray(capability.allowedOps)
        || [...capability.allowedOps].sort().join(',') !== 'event,finish,usage'
        || Date.parse(capability.expiresAt) <= Date.now())
        throw new Error('Execution capability drain response changed');
      const scoped: ExecutionCapability = { token: capability.token, protocolVersion: 1,
        allowedOps: capability.allowedOps, expiresAt: capability.expiresAt, recoveryMode: 'drain' };
      await saveExecutionCapability(root, executionId, record.dispatchToken, scoped, true,
        recovery.id, Number(recovery.generation));
      return capability.token;
    } finally { await lock.release(); }
  }

  private machineIdForCapability: string | null = null;
  setExecutionCapabilityMachine(machineId: string): void { this.machineIdForCapability = machineId; }

  async requestExecutionApproval(input: { executionId: string; machineId: string;
    operationId: string; actionType: string; actionHash: string;
    summary: string; expiresAt: string }): Promise<{ id: string; version: number; expiresAt: string }> {
    const headers = { Authorization: `Bearer ${this.credential.token}` };
    const url = `${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(input.executionId)}`;
    const scoped = await this.executionCapability(input.executionId, 'decision_request');
    const issued = scoped ? null : await axios.post(`${url}/capabilities`, { allowedOps: ['decision_request'],
      expiresInSeconds: 300 }, { headers, timeout: 10_000 });
    const capability = scoped ?? issued?.data?.token;
    if (typeof capability !== 'string' || !/^[0-9a-f]{64}$/.test(capability))
      throw new Error('Execution decision capability unavailable');
    const response = await axios.post(`${url}/decisions`, { machineId: input.machineId,
      capability, kind: 'approval', operationId: input.operationId,
      actionType: input.actionType, actionHash: input.actionHash,
      summary: input.summary, expiresAt: input.expiresAt }, { headers, timeout: 10_000 });
    const value = response.data;
    if (typeof value?.id !== 'string' || !Number.isSafeInteger(value.version)
      || value.operationId !== input.operationId || value.actionHash !== input.actionHash
      || value.expiresAt !== input.expiresAt) throw new Error('Execution decision response identity changed');
    return { id: value.id, version: value.version, expiresAt: value.expiresAt };
  }

  async proposeExecutionTemplate(input: { executionId: string; machineId: string;
    dispatchToken: string; templateId: string; expectedCurrentVersion: number;
    clientRequestId: string; content: { role: string; description: string; emoji: string;
      skills: string[]; responsibilities: string[]; instructions: string }; note: string }):
    Promise<{ id: string; status: 'pending'; duplicate: boolean }> {
    const capability = await this.executionCapability(input.executionId, 'template_propose');
    if (!capability) throw new Error('Template proposal execution scope unavailable');
    const body = AiExecutionTemplateProposalInputSchema.parse({
      machineId: input.machineId, dispatchToken: input.dispatchToken, capability,
        templateId: input.templateId, clientRequestId: input.clientRequestId,
        expectedCurrentVersion: input.expectedCurrentVersion, content: input.content,
        note: input.note });
    const response = await axios.post(`${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(input.executionId)}/template-proposals`,
      body, { headers: { Authorization: `Bearer ${this.credential.token}` },
        timeout: 15_000 });
    const value = response.data;
    if (typeof value?.id !== 'string' || !value.id || value.status !== 'pending'
      || typeof value.duplicate !== 'boolean')
      throw new Error('Template proposal acknowledgement changed');
    return { id: value.id, status: 'pending', duplicate: value.duplicate };
  }

  async getExecutionTemplateProposalContext(input: { executionId: string; machineId: string;
    dispatchToken: string }): Promise<{ templateId: string; sourceExecutionId: string;
      frozenVersion: number; currentVersion: number; frozenContent: { role: string;
        description: string; emoji: string; skills: string[]; responsibilities: string[];
        instructions: string } }> {
    const capability = await this.executionCapability(input.executionId, 'template_propose');
    if (!capability) throw new Error('Template proposal execution scope unavailable');
    const response = await axios.post(`${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(input.executionId)}/template-proposals/context`,
      { machineId: input.machineId, dispatchToken: input.dispatchToken, capability },
      { headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 15_000 });
    const value = AiExecutionTemplateContextSchema.parse(response.data);
    if (value.sourceExecutionId !== input.executionId
      || createHash('sha256').update(JSON.stringify(value.frozenContent)).digest('hex') !== value.frozenContentHash
      || createHash('sha256').update(JSON.stringify(value.currentContent)).digest('hex') !== value.currentContentHash)
      throw new Error('Template proposal context identity changed');
    return { templateId: value.templateId, sourceExecutionId: value.sourceExecutionId,
      frozenVersion: value.frozenVersion, currentVersion: value.currentVersion,
      frozenContent: value.frozenContent };
  }

  async bindExecutionIdentity(input: { executionId: string; dispatchToken: string;
    machineId: string; childSessionId: string; worktreePath: string; branchName: string }): Promise<void> {
    const capability = await this.executionCapability(input.executionId, 'identity');
    const response = await axios.post(`${configuration.serverUrl}/v1/orchestrator/executions/${encodeURIComponent(input.executionId)}/identity`,
      { dispatchToken: input.dispatchToken, machineId: input.machineId,
        ...(capability ? { capability } : {}), childSessionId: input.childSessionId, worktreePath: input.worktreePath,
        branchName: input.branchName }, {
        headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 10_000,
      });
    if (response.data?.ok !== true || response.data?.executionId !== input.executionId
      || response.data?.childSessionId !== input.childSessionId
      || response.data?.branchName !== input.branchName)
      throw new Error('Execution identity response changed');
  }

  async requireExecutionTelemetry(executionId: string): Promise<void> {
    if (await this.executionCapability(executionId, 'event')) {
      await this.executionCapability(executionId, 'usage');
      return;
    }
    const headers = { Authorization: `Bearer ${this.credential.token}` };
    for (const operation of ['event', 'usage'] as const) {
      let issued;
      try {
        issued = await axios.post(`${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(executionId)}/capabilities`,
          { allowedOps: [operation], expiresInSeconds: 300 }, { headers, timeout: 10_000,
            maxRedirects: 0 });
      } catch (error) {
        if (operation === 'event' && error && typeof error === 'object')
          Object.assign(error, { telemetryPreflightOperation: 'event' });
        throw error;
      }
      if (typeof issued.data?.token !== 'string' || !/^[0-9a-f]{64}$/.test(issued.data.token))
        throw new Error('Execution telemetry capability unavailable');
    }
  }

  async identifyFixedLegacyExecution(payload: OrchestratorDispatchPayload,
    machineId: string): Promise<'agent' | 'generic'> {
    const headers = { Authorization: `Bearer ${this.credential.token}` };
    const options = { headers, timeout: 10_000, maxRedirects: 0,
      maxContentLength: 8 * 1024 * 1024 };
    const state = await axios.get(`${configuration.serverUrl}/v1/ai-team/state`, options);
    if (state.status !== 200 || Buffer.byteLength(JSON.stringify(state.data), 'utf8') > options.maxContentLength)
      throw new Error('Legacy Agent state size is unverified');
    const task = await axios.get(`${configuration.serverUrl}/v1/orchestrator/runs/${encodeURIComponent(payload.runId)}`
      + `/tasks/${encodeURIComponent(payload.taskId)}?includeExecutions=true`, options);
    if (task.status !== 200 || Buffer.byteLength(JSON.stringify(task.data), 'utf8') > options.maxContentLength)
      throw new Error('Legacy task response size is unverified');
    return identifyFixedLegacyOrigin(state.data, task.data, payload, machineId);
  }

  async reportUsageDelta(item: UsageDelta): Promise<void> {
    const headers = { Authorization: `Bearer ${this.credential.token}` };
    const scoped = await this.executionCapability(item.executionId, 'usage');
    const issued = scoped ? null : await axios.post(`${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(item.executionId)}/capabilities`,
      { allowedOps: ['usage'], expiresInSeconds: 300 }, { headers, timeout: 10_000 });
    const capability = scoped ?? issued?.data?.token;
    if (typeof capability !== 'string' || !/^[0-9a-f]{64}$/.test(capability))
      throw new Error('Execution usage capability unavailable');
    const { executionId: _executionId, ...body } = item;
    await axios.post(`${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(item.executionId)}/usage-deltas`,
      { ...body, capability }, { headers, timeout: 10_000 });
  }

  async reportExecutionEvent(event: ExecutionEvent): Promise<void> {
    const headers = { Authorization: `Bearer ${this.credential.token}` };
    const scoped = await this.executionCapability(event.executionId, 'event');
    const issued = scoped ? null : await axios.post(`${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(event.executionId)}/capabilities`,
      { allowedOps: ['event'], expiresInSeconds: 300 }, { headers, timeout: 10_000 });
    const capability = scoped ?? issued?.data?.token;
    if (typeof capability !== 'string' || !/^[0-9a-f]{64}$/.test(capability))
      throw new Error('Execution event capability unavailable');
    const { executionId: _executionId, ...body } = event;
    await axios.post(`${configuration.serverUrl}/v1/ai-team/executions/${encodeURIComponent(event.executionId)}/events`,
      { ...body, capability }, { headers, timeout: 10_000 });
  }

  async verifyRegisteredProject(snapshot: ProjectSnapshot): Promise<void> {
    const verified = await verifyRegisteredRepo(this.credential.token, snapshot.machineId, {
      registeredRepoId: snapshot.registeredRepoId, workingDirectory: snapshot.workingDirectory,
      defaultBranch: snapshot.defaultBranch,
    });
    if (verified.registeredKvVersion !== snapshot.registeredKvVersion
      || verified.commonGitDirHash !== snapshot.commonGitDirHash
      || verified.baseCommit !== snapshot.baseCommit)
      throw new Error('Project registered repository changed since task creation');
  }

  async getOrchestratorTaskSkills(taskId: string, executionId: string, dispatchToken: string): Promise<Array<{
    skillId: string; version: number; hash: string;
    files: Array<{ path: string; sha256: string; contentBase64: string }>;
  }>> {
    const capability = await this.executionCapability(executionId, 'skill_download');
    const response = await axios.post(`${configuration.serverUrl}/v1/ai-team/tasks/${encodeURIComponent(taskId)}/skills/download`,
      { executionId, dispatchToken, ...(capability ? { capability } : {}) }, {
      headers: { Authorization: `Bearer ${this.credential.token}` },
      timeout: 15_000, maxContentLength: 3_000_000,
    });
    if (!Array.isArray(response.data?.items) || response.data.items.length > 32)
      throw new Error('Task skill snapshot is invalid');
    return response.data.items;
  }

  async delegateAiTeamTask(taskId: string, body: {
    dispatchToken: string; delegationKey: string; assignedAgentId: string; title: string;
    requirements: string; dependsOnTaskIds: string[];
  }, executionId?: string): Promise<{ taskId: string; runId: string; duplicate: boolean }> {
    const capability = executionId ? await this.executionCapability(executionId, 'delegate') : null;
    const response = await axios.post(`${configuration.serverUrl}/v1/ai-team/tasks/${encodeURIComponent(taskId)}/delegations`,
      { ...body, ...(capability ? { capability } : {}) }, {
      headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 15_000,
    });
    return response.data;
  }

  async getOrchestratorRunTasks(runId: string): Promise<Array<{
    taskId: string; taskKey: string; status: string; dependsOn: string[];
  }>> {
    const response = await axios.get(`${configuration.serverUrl}/v1/orchestrator/runs/${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 15_000,
    });
    const tasks = response.data?.data?.tasks;
    if (!Array.isArray(tasks)) throw new Error('Run tasks are unavailable');
    return tasks;
  }

  async getOrchestratorRecoveryExecution(runId: string, executionId: string, taskId: string): Promise<{
    status: string; machineId: string | null; childSessionId: string | null;
    provider: string; latest: boolean }> {
    const task = await axios.get(`${configuration.serverUrl}/v1/orchestrator/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 15_000,
      params: { includeExecutions: true },
    });
    const data = task.data?.data?.task;
    if (task.data?.data?.run?.runId !== runId
      || data?.taskId !== taskId || !Array.isArray(data.executions))
      throw new Error('Approval server task identity unavailable');
    const executions = data.executions as Array<{ executionId: string; status: string; machineId: string | null;
      childSessionId: string | null; provider: string; attempt: number }>;
    const item = executions.find((row) => row.executionId === executionId);
    if (!item || !Number.isSafeInteger(item.attempt))
      throw new Error('Approval server execution identity unavailable');
    return { status: item.status, machineId: item.machineId,
      childSessionId: item.childSessionId, provider: item.provider,
      latest: executions.every((row) => row.executionId === executionId || row.attempt < item.attempt) };
  }

  static async create(credential: Credentials) {
    return new ApiClient(credential);
  }

  private readonly credential: Credentials;
  private readonly pushClient: PushNotificationClient;

  private constructor(credential: Credentials) {
    this.credential = credential
    this.pushClient = new PushNotificationClient(credential.token, configuration.serverUrl)
  }

  /**
   * Create a new session or load existing one with the given tag
   */
  async getOrCreateSession(opts: {
    tag: string,
    metadata: Metadata,
    state: AgentState | null
  }): Promise<Session | null> {

    // Resolve encryption key
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: 'legacy' | 'dataKey';
    if (this.credential.encryption.type === 'dataKey') {

      // Generate new encryption key
      encryptionKey = getRandomBytes(32);
      encryptionVariant = 'dataKey';

      // Derive and encrypt data encryption key
      // const contentDataKey = await deriveKey(this.secret, 'Happy EnCoder', ['content']);
      // const publicKey = libsodiumPublicKeyFromSecretKey(contentDataKey);
      let encryptedDataKey = libsodiumEncryptForPublicKey(encryptionKey, this.credential.encryption.publicKey);
      dataEncryptionKey = new Uint8Array(encryptedDataKey.length + 1);
      dataEncryptionKey.set([0], 0); // Version byte
      dataEncryptionKey.set(encryptedDataKey, 1); // Data key
    } else {
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = 'legacy';
    }

    // Create session
    try {
      const response = await axios.post<CreateSessionResponse>(
        `${configuration.serverUrl}/v1/sessions`,
        {
          tag: opts.tag,
          metadata: encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.metadata)),
          agentState: opts.state ? encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.state)) : null,
          dataEncryptionKey: dataEncryptionKey ? encodeBase64(dataEncryptionKey) : null,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 1 minute timeout for very bad network connections
        }
      )

      logger.debug(`Session created/loaded: ${response.data.session.id} (tag: ${opts.tag})`)
      let raw = response.data.session;
      let session: Session = {
        id: raw.id,
        seq: raw.seq,
        metadata: decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.metadata)),
        metadataVersion: raw.metadataVersion,
        agentState: raw.agentState ? decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.agentState)) : null,
        agentStateVersion: raw.agentStateVersion,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant
      }
      return session;
    } catch (error) {
      logger.debug('[API] [ERROR] Failed to get or create session:', error);

      // Check if it's a connection error
      if (error && typeof error === 'object' && 'code' in error) {
        const errorCode = (error as any).code;
        if (isNetworkError(errorCode)) {
          connectionState.fail({
            operation: 'Session creation',
            caller: 'api.getOrCreateSession',
            errorCode,
            url: `${configuration.serverUrl}/v1/sessions`
          });
          return null;
        }
      }

      // Handle 404 gracefully - server endpoint may not be available yet
      const is404Error = (
        (axios.isAxiosError(error) && error.response?.status === 404) ||
        (error && typeof error === 'object' && 'response' in error && (error as any).response?.status === 404)
      );
      if (is404Error) {
        connectionState.fail({
          operation: 'Session creation',
          errorCode: '404',
          url: `${configuration.serverUrl}/v1/sessions`
        });
        return null;
      }

      // Handle 5xx server errors - use offline mode with auto-reconnect
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;
        if (status >= 500) {
          connectionState.fail({
            operation: 'Session creation',
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/sessions`,
            details: ['Server encountered an error, will retry automatically']
          });
          return null;
        }
      }

      throw new Error(`Failed to get or create session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Register or update machine with the server
   * Returns the current machine state from the server with decrypted metadata and daemonState
   */
  async getOrCreateMachine(opts: {
    machineId: string,
    metadata: MachineMetadata,
    daemonState?: DaemonState,
  }): Promise<Machine> {

    // Resolve encryption key
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: 'legacy' | 'dataKey';
    if (this.credential.encryption.type === 'dataKey') {
      // Encrypt data encryption key
      encryptionVariant = 'dataKey';
      encryptionKey = this.credential.encryption.machineKey;
      let encryptedDataKey = libsodiumEncryptForPublicKey(this.credential.encryption.machineKey, this.credential.encryption.publicKey);
      dataEncryptionKey = new Uint8Array(encryptedDataKey.length + 1);
      dataEncryptionKey.set([0], 0); // Version byte
      dataEncryptionKey.set(encryptedDataKey, 1); // Data key
    } else {
      // Legacy encryption
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = 'legacy';
    }

    // Helper to create minimal machine object for offline mode (DRY)
    const createMinimalMachine = (): Machine => ({
      id: opts.machineId,
      encryptionKey: encryptionKey,
      encryptionVariant: encryptionVariant,
      metadata: opts.metadata,
      metadataVersion: 0,
      daemonState: opts.daemonState || null,
      daemonStateVersion: 0,
    });

    // Create machine
    try {
      const response = await axios.post(
        `${configuration.serverUrl}/v1/machines`,
        {
          id: opts.machineId,
          metadata: encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.metadata)),
          daemonState: opts.daemonState ? encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.daemonState)) : undefined,
          dataEncryptionKey: dataEncryptionKey ? encodeBase64(dataEncryptionKey) : undefined
        },
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 1 minute timeout for very bad network connections
        }
      );


      const raw = response.data.machine;
      logger.debug(`[API] Machine ${opts.machineId} registered/updated with server`);

      // Return decrypted machine like we do for sessions
      const machine: Machine = {
        id: raw.id,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant,
        metadata: raw.metadata ? decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.metadata)) : null,
        metadataVersion: raw.metadataVersion || 0,
        daemonState: raw.daemonState ? decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.daemonState)) : null,
        daemonStateVersion: raw.daemonStateVersion || 0,
      };
      return machine;
    } catch (error) {
      // Handle connection errors gracefully
      if (axios.isAxiosError(error) && error.code && isNetworkError(error.code)) {
        connectionState.fail({
          operation: 'Machine registration',
          caller: 'api.getOrCreateMachine',
          errorCode: error.code,
          url: `${configuration.serverUrl}/v1/machines`
        });
        return createMinimalMachine();
      }

      // Handle 403/409 - server rejected request due to authorization conflict
      // This is NOT "server unreachable" - server responded, so don't use connectionState
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;

        if (status === 403 || status === 409) {
          // Re-auth conflict: machine registered to old account, re-association not allowed
          console.log(chalk.yellow(
            `⚠️  Machine registration rejected by the server with status ${status}`
          ));
          console.log(chalk.yellow(
            `   → This machine ID is already registered to another account on the server`
          ));
          console.log(chalk.yellow(
            `   → This usually happens after re-authenticating with a different account`
          ));
          console.log(chalk.yellow(
            `   → Run 'happy doctor clean' to reset local state and generate a new machine ID`
          ));
          console.log(chalk.yellow(
            `   → Open a GitHub issue if this problem persists`
          ));
          return createMinimalMachine();
        }

        // Handle 5xx - server error, use offline mode with auto-reconnect
        if (status >= 500) {
          connectionState.fail({
            operation: 'Machine registration',
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/machines`,
            details: ['Server encountered an error, will retry automatically']
          });
          return createMinimalMachine();
        }

        // Handle 404 - endpoint may not be available yet
        if (status === 404) {
          connectionState.fail({
            operation: 'Machine registration',
            errorCode: '404',
            url: `${configuration.serverUrl}/v1/machines`
          });
          return createMinimalMachine();
        }
      }

      // For other errors, rethrow
      throw error;
    }
  }

  sessionSyncClient(session: Session): ApiSessionClient {
    return new ApiSessionClient(this.credential.token, session);
  }

  machineSyncClient(machine: Machine): ApiMachineClient {
    return new ApiMachineClient(this.credential.token, machine);
  }

  push(): PushNotificationClient {
    return this.pushClient;
  }

  /**
   * Report orchestrator execution start (daemon -> server)
   */
  async reportOrchestratorExecutionStart(opts: {
    executionId: string;
    dispatchToken: string;
    startedAt: string;
    pid?: number;
  }): Promise<void> {
    await axios.post(
      `${configuration.serverUrl}/v1/orchestrator/executions/${opts.executionId}/start`,
      {
        dispatchToken: opts.dispatchToken,
        startedAt: opts.startedAt,
        ...(typeof opts.pid === 'number' ? { pid: opts.pid } : {}),
      },
      {
        headers: {
          'Authorization': `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000,
      }
    );
  }

  /**
   * Report orchestrator execution finish (daemon -> server)
   */
  async reportOrchestratorExecutionFinish(opts: {
    executionId: string;
    dispatchToken: string;
    status: 'completed' | 'failed' | 'cancelled' | 'timeout';
    finishedAt: string;
    childSessionId?: string | null;
    exitCode?: number | null;
    signal?: string | null;
    outputSummary?: string | null;
    outputText?: string | null;
    finalResponse?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    worktreePath?: string | null;
    branchName?: string | null;
    baseCommit?: string | null;
    commitSha?: string | null;
    pullRequestUrl?: string | null;
    pullRequestNumber?: number | null;
    integrationProof?: {
      baseCommit: string;
      aggregateCommit: string;
      members: Array<{ taskId: string; branchName: string; sourceCommit: string; integratedCommit: string }>;
    };
  }): Promise<void> {
    const capability = await this.executionCapability(opts.executionId, 'finish');
    const persisted = this.executionCapabilityRoot && capability
      ? await loadExecutionCapability(this.executionCapabilityRoot, opts.executionId) : null;
    if (persisted?.capability.recoveryMode === 'drain') {
      opts = { ...opts, status: 'failed', exitCode: opts.exitCode === 0 ? 1 : opts.exitCode ?? 1,
        errorCode: 'EXECUTION_CAPABILITY_EXPIRED',
        errorMessage: 'Expired execution capability required confirmed audit drain',
        outputSummary: null, outputText: null, finalResponse: null,
        commitSha: null, pullRequestUrl: null, pullRequestNumber: null,
        integrationProof: undefined };
    }
    await axios.post(
      `${configuration.serverUrl}/v1/orchestrator/executions/${opts.executionId}/finish`,
      {
        dispatchToken: opts.dispatchToken,
        ...(capability ? { capability } : {}),
        status: opts.status,
        finishedAt: opts.finishedAt,
        ...(opts.childSessionId !== undefined ? { childSessionId: opts.childSessionId } : {}),
        ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        ...(opts.outputSummary !== undefined ? { outputSummary: opts.outputSummary } : {}),
        ...(opts.outputText !== undefined ? { outputText: opts.outputText } : {}),
        ...(opts.finalResponse !== undefined ? { finalResponse: opts.finalResponse } : {}),
        ...(opts.errorCode !== undefined ? { errorCode: opts.errorCode } : {}),
        ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
        ...(opts.worktreePath !== undefined ? { worktreePath: opts.worktreePath } : {}),
        ...(opts.branchName !== undefined ? { branchName: opts.branchName } : {}),
        ...(opts.baseCommit !== undefined ? { baseCommit: opts.baseCommit } : {}),
        ...(opts.commitSha !== undefined ? { commitSha: opts.commitSha } : {}),
        ...(opts.pullRequestUrl !== undefined ? { pullRequestUrl: opts.pullRequestUrl } : {}),
        ...(opts.pullRequestNumber !== undefined ? { pullRequestNumber: opts.pullRequestNumber } : {}),
        ...(opts.integrationProof !== undefined ? { integrationProof: opts.integrationProof } : {}),
      },
      {
        headers: {
          'Authorization': `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000,
      }
    );
    if (opts.status === 'completed' && this.approvalJournalRoot)
      await acknowledgeApprovalFinish(this.approvalJournalRoot, opts.executionId);
  }

  /**
   * Register a vendor API token with the server
   * The token is sent as a JSON string - server handles encryption
   */
  async registerVendorToken(vendor: 'openai' | 'anthropic' | 'gemini', apiKey: any): Promise<void> {
    try {
      const response = await axios.post(
        `${configuration.serverUrl}/v1/connect/${vendor}/register`,
        {
          token: JSON.stringify(apiKey)
        },
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`Server returned status ${response.status}`);
      }

      logger.debug(`[API] Vendor token for ${vendor} registered successfully`);
    } catch (error) {
      logger.debug(`[API] [ERROR] Failed to register vendor token:`, error);
      throw new Error(`Failed to register vendor token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get vendor API token from the server
   * Returns the token if it exists, null otherwise
   */
  async getVendorToken(vendor: 'openai' | 'anthropic' | 'gemini'): Promise<any | null> {
    try {
      const response = await axios.get(
        `${configuration.serverUrl}/v1/connect/${vendor}/token`,
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      if (response.status === 404) {
        logger.debug(`[API] No vendor token found for ${vendor}`);
        return null;
      }

      if (response.status !== 200) {
        throw new Error(`Server returned status ${response.status}`);
      }

      // Log raw response for debugging
      logger.debug(`[API] Raw vendor token response:`, {
        status: response.status,
        dataKeys: Object.keys(response.data || {}),
        hasToken: 'token' in (response.data || {}),
        tokenType: typeof response.data?.token,
      });

      // Token is returned as JSON string, parse it
      let tokenData: any = null;
      if (response.data?.token) {
        if (typeof response.data.token === 'string') {
          try {
            tokenData = JSON.parse(response.data.token);
          } catch (parseError) {
            logger.debug(`[API] Failed to parse token as JSON, using as string:`, parseError);
            tokenData = response.data.token;
          }
        } else if (response.data.token !== null) {
          // Token exists and is not null
          tokenData = response.data.token;
        } else {
          // Token is explicitly null - treat as not found
          logger.debug(`[API] Token is null for ${vendor}, treating as not found`);
          return null;
        }
      } else if (response.data && typeof response.data === 'object') {
        // Maybe the token is directly in response.data
        // But check if it's { token: null } - treat as not found
        if (response.data.token === null && Object.keys(response.data).length === 1) {
          logger.debug(`[API] Response contains only null token for ${vendor}, treating as not found`);
          return null;
        }
        tokenData = response.data;
      }
      
      // Final check: if tokenData is null or { token: null }, return null
      if (tokenData === null || (tokenData && typeof tokenData === 'object' && tokenData.token === null && Object.keys(tokenData).length === 1)) {
        logger.debug(`[API] Token data is null for ${vendor}`);
        return null;
      }
      
      logger.debug(`[API] Vendor token for ${vendor} retrieved successfully`, {
        tokenDataType: typeof tokenData,
        tokenDataKeys: tokenData && typeof tokenData === 'object' ? Object.keys(tokenData) : 'not an object',
      });
      return tokenData;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`[API] No vendor token found for ${vendor}`);
        return null;
      }
      logger.debug(`[API] [ERROR] Failed to get vendor token:`, error);
      return null;
    }
  }
}
