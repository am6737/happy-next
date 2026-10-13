import { appendFile, mkdir, open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
    MESSAGE_ARCHIVE_VERSION,
    messageArchiveEntrySchema,
    messageMatchesSearchQuery,
    messageSearchSnippet,
    normalizeMessageSearchText,
    type MessageArchiveEntry,
    type MessageArchiveHeader,
    type MessageSearchHit,
    type SearchMessagesRequest,
    type SearchMessagesResponse,
} from 'happy-wire';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

// Every session's searchable messages, kept on the machine that ran it, so the daemon can search the
// whole history while the server only ever holds them encrypted. One `<sessionId>.jsonl` per
// session: a header line, then one line per message (see happy-wire's messageSearch).

const ARCHIVE_EXTENSION = '.jsonl';

const archiveDir = () => join(configuration.happyHomeDir, 'messages');

export type MessageArchiveHeaderFields = Omit<MessageArchiveHeader, 'type' | 'v' | 'createdAt'>;

/**
 * Appends one session's messages to its archive, creating the file with its header on the first write.
 * Only the session's own process writes to it, so writes are chained rather than locked.
 */
export class MessageArchiveWriter {
    private chain: Promise<void> = Promise.resolve();

    constructor(private readonly describeSession: () => MessageArchiveHeaderFields) {}

    append(entries: MessageArchiveEntry[]) {
        if (entries.length === 0) return;
        this.chain = this.chain
            .then(() => this.write(entries))
            .catch((error) => logger.warn('[MessageArchive] Failed to append messages:', error));
    }

    private async write(entries: MessageArchiveEntry[]) {
        const fields = this.describeSession();
        if (!/^[a-zA-Z0-9_-]+$/.test(fields.sessionId)) throw new Error('invalid-session-id');
        const file = join(archiveDir(), `${fields.sessionId}${ARCHIVE_EXTENSION}`);
        await mkdir(archiveDir(), { recursive: true, mode: 0o700 });
        try {
            const handle = await open(file, 'wx', 0o600);
            const header: MessageArchiveHeader = { type: 'header', v: MESSAGE_ARCHIVE_VERSION, ...fields, createdAt: Date.now() };
            await handle.writeFile(`${JSON.stringify(header)}\n`);
            await handle.close();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        await appendFile(file, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''), { mode: 0o600 });
    }
}

type IndexedEntry = MessageArchiveEntry & { normalizedText: string };

// Parsed archives by file, reused until the file changes, so repeated searches only read what grew.
// They take about twice the archive's size in memory, so they are dropped once searching goes quiet.
const parsedArchives = new Map<string, { mtimeMs: number; size: number; entries: IndexedEntry[] }>();
const PARSED_ARCHIVES_IDLE_MS = 10 * 60 * 1000;
let releaseTimer: NodeJS.Timeout | null = null;

async function readArchiveEntries(file: string): Promise<IndexedEntry[]> {
    const { mtimeMs, size } = await stat(file);
    const cached = parsedArchives.get(file);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.entries;

    // Keyed by message id, so a message written twice is found once
    const byId = new Map<string, IndexedEntry>();
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
        if (!line) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            // A line cut short by a crash mid-write; the rest of the file is still good
            continue;
        }
        const entry = messageArchiveEntrySchema.safeParse(parsed);
        if (entry.success) byId.set(entry.data.id, { ...entry.data, normalizedText: normalizeMessageSearchText(entry.data.text) });
    }
    const entries = [...byId.values()].sort((a, b) => a.seq - b.seq);
    parsedArchives.set(file, { mtimeMs, size, entries });
    return entries;
}

/** Newest hits first: sessions by their newest hit, and up to `perSessionLimit` hits within each. */
export async function searchMessageArchive(request: SearchMessagesRequest): Promise<SearchMessagesResponse> {
    if (normalizeMessageSearchText(request.query).length < 2) return { hits: [] };
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => parsedArchives.clear(), PARSED_ARCHIVES_IDLE_MS).unref();
    const limit = request.limit ?? 50;
    const perSessionLimit = request.perSessionLimit ?? 10;

    let names: string[];
    try {
        names = (await readdir(archiveDir())).filter((name) => name.endsWith(ARCHIVE_EXTENSION));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { hits: [] };
        throw error;
    }
    const files = new Set(names.map((name) => join(archiveDir(), name)));
    for (const file of parsedArchives.keys()) {
        if (!files.has(file)) parsedArchives.delete(file);
    }

    const sessions = await Promise.all(names.map(async (name) => {
        const sessionId = name.slice(0, -ARCHIVE_EXTENSION.length);
        const entries = await readArchiveEntries(join(archiveDir(), name)).catch((error) => {
            logger.warn(`[MessageArchive] Failed to read ${name}:`, error);
            return [];
        });
        const hits: MessageSearchHit[] = [];
        for (let index = entries.length - 1; index >= 0 && hits.length < perSessionLimit; index--) {
            const entry = entries[index];
            if (!messageMatchesSearchQuery(entry.normalizedText, request.query)) continue;
            hits.push({
                sessionId,
                id: entry.id,
                seq: entry.seq,
                localId: entry.localId,
                role: entry.role,
                snippet: messageSearchSnippet(entry.text, request.query),
                createdAt: entry.createdAt,
            });
        }
        return hits;
    }));

    return {
        hits: sessions
            .filter((hits) => hits.length > 0)
            .sort((a, b) => b[0].createdAt - a[0].createdAt)
            .flat()
            .slice(0, limit),
    };
}
