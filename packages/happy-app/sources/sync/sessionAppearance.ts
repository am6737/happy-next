export const SESSION_APPEARANCE_KV_KEY = 'session-appearance:v1';
export const SESSION_APPEARANCE_SCHEMA_VERSION = 1 as const;

export const SESSION_MARKER_COLORS = [
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'gray',
] as const;

export type SessionMarkerColor = typeof SESSION_MARKER_COLORS[number];

export interface SessionAppearanceEntry {
    color: SessionMarkerColor;
    updatedAt: number;
}

export interface SessionAppearanceDocument {
    schemaVersion: typeof SESSION_APPEARANCE_SCHEMA_VERSION;
    updatedAt: number;
    sessions: Record<string, SessionAppearanceEntry>;
}

export interface SessionAppearancePatch {
    sessionId: string;
    color: SessionMarkerColor | null;
    updatedAt: number;
}

const markerColorSet = new Set<string>(SESSION_MARKER_COLORS);

function isMarkerColor(value: unknown): value is SessionMarkerColor {
    return typeof value === 'string' && markerColorSet.has(value);
}

function toBase64Utf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]!);
    }
    return typeof btoa === 'function'
        ? btoa(binary)
        : Buffer.from(binary, 'binary').toString('base64');
}

function fromBase64Utf8(value: string): string {
    const binary = typeof atob === 'function'
        ? atob(value)
        : Buffer.from(value, 'base64').toString('binary');
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

export function createEmptySessionAppearance(now: number = Date.now()): SessionAppearanceDocument {
    return {
        schemaVersion: SESSION_APPEARANCE_SCHEMA_VERSION,
        updatedAt: now,
        sessions: {},
    };
}

export function normalizeSessionAppearance(input: unknown, now: number = Date.now()): SessionAppearanceDocument {
    if (!input || typeof input !== 'object') return createEmptySessionAppearance(now);

    const raw = input as Record<string, unknown>;
    const rawSessions = raw.sessions && typeof raw.sessions === 'object'
        ? raw.sessions as Record<string, unknown>
        : {};
    const sessions: Record<string, SessionAppearanceEntry> = {};

    for (const [sessionId, rawEntry] of Object.entries(rawSessions)) {
        if (!sessionId.trim() || !rawEntry || typeof rawEntry !== 'object') continue;
        const entry = rawEntry as Record<string, unknown>;
        if (!isMarkerColor(entry.color)) continue;
        sessions[sessionId] = {
            color: entry.color,
            updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
                ? entry.updatedAt
                : now,
        };
    }

    return {
        schemaVersion: SESSION_APPEARANCE_SCHEMA_VERSION,
        updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
        sessions,
    };
}

export function applySessionAppearancePatch(
    document: SessionAppearanceDocument,
    patch: SessionAppearancePatch,
): SessionAppearanceDocument {
    const normalized = normalizeSessionAppearance(document, patch.updatedAt);
    const sessionId = patch.sessionId.trim();
    if (!sessionId) return normalized;

    const sessions = { ...normalized.sessions };
    if (patch.color === null) {
        delete sessions[sessionId];
    } else {
        sessions[sessionId] = { color: patch.color, updatedAt: patch.updatedAt };
    }

    return {
        schemaVersion: SESSION_APPEARANCE_SCHEMA_VERSION,
        updatedAt: Math.max(normalized.updatedAt, patch.updatedAt),
        sessions,
    };
}

export function applySessionAppearancePatches(
    document: SessionAppearanceDocument,
    patches: SessionAppearancePatch[],
): SessionAppearanceDocument {
    return patches.reduce(applySessionAppearancePatch, document);
}

export function encodeSessionAppearanceValue(document: SessionAppearanceDocument): string {
    return toBase64Utf8(JSON.stringify(normalizeSessionAppearance(document, document.updatedAt)));
}

export function decodeSessionAppearanceValue(value: string | null | undefined): SessionAppearanceDocument {
    if (!value) return createEmptySessionAppearance();
    try {
        return normalizeSessionAppearance(JSON.parse(fromBase64Utf8(value)));
    } catch {
        return createEmptySessionAppearance();
    }
}
