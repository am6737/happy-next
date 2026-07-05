import { MMKV } from 'react-native-mmkv';
import type { AppConfig } from './appConfig';

// Separate MMKV instance for server config that persists across logouts
const serverConfigStorage = new MMKV({ id: 'server-config' });

const SERVER_KEY = 'custom-server-url';
const DEFAULT_SERVER_URL = 'https://api.happy-next.com';
const APP_CONFIG_PATH = '/v1/app-config';
const DISCOVERY_TIMEOUT_MS = 5000;

interface RemoteAppConfigResponse {
    apiBaseUrl?: unknown;
    voice?: {
        baseUrl?: unknown;
    } | null;
}

interface ResolvedVoiceConfig {
    baseUrl?: string;
}

let configRef: AppConfig | undefined;
let resolvedServerUrl: string | null = null;
let resolvedVoiceConfig: ResolvedVoiceConfig = {};
let resolvePromise: Promise<void> | null = null;

function normalizeUrl(url: string | null | undefined): string | null {
    const trimmed = url?.trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return trimmed.replace(/\/+$/, '');
    } catch {
        return null;
    }
}

function normalizeString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getCustomServerUrl(): string | null {
    return normalizeUrl(serverConfigStorage.getString(SERVER_KEY));
}

function getEntryServerUrl(): string {
    return getCustomServerUrl()
        || normalizeUrl(process.env.EXPO_PUBLIC_HAPPY_SERVER_URL)
        || normalizeUrl(configRef?.serverUrl)
        || DEFAULT_SERVER_URL;
}

async function fetchRemoteAppConfig(entryServerUrl: string): Promise<RemoteAppConfigResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
        const response = await fetch(`${entryServerUrl}${APP_CONFIG_PATH}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data && typeof data === 'object' ? data as RemoteAppConfigResponse : null;
    } catch (error) {
        console.warn('[serverConfig] Failed to fetch remote app config:', error);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export function initServerConfig(config: AppConfig): void {
    configRef = config;
}

export async function resolveServerConfig(): Promise<void> {
    if (resolvePromise) return resolvePromise;

    resolvePromise = (async () => {
        const entryServerUrl = getEntryServerUrl();
        const remoteConfig = await fetchRemoteAppConfig(entryServerUrl);
        const remoteApiBaseUrl = normalizeUrl(normalizeString(remoteConfig?.apiBaseUrl));

        resolvedServerUrl = remoteApiBaseUrl || entryServerUrl;
        resolvedVoiceConfig = {
            baseUrl: normalizeUrl(normalizeString(remoteConfig?.voice?.baseUrl)) || undefined,
        };
    })();

    return resolvePromise;
}

export function getServerUrl(): string {
    return resolvedServerUrl || getEntryServerUrl();
}

export function getDiscoveredVoiceConfig(): ResolvedVoiceConfig {
    return resolvedVoiceConfig;
}

export function setServerUrl(url: string | null): void {
    if (url && url.trim()) {
        serverConfigStorage.set(SERVER_KEY, url.trim());
    } else {
        serverConfigStorage.delete(SERVER_KEY);
    }
    resolvedServerUrl = null;
    resolvedVoiceConfig = {};
    resolvePromise = null;
}

export function isUsingCustomServer(): boolean {
    return getCustomServerUrl() != null;
}

export function getServerInfo(): { hostname: string; port?: number; isCustom: boolean } {
    const url = getServerUrl();
    const isCustom = isUsingCustomServer();
    
    try {
        const parsed = new URL(url);
        const port = parsed.port ? parseInt(parsed.port) : undefined;
        return {
            hostname: parsed.hostname,
            port,
            isCustom
        };
    } catch {
        // Fallback if URL parsing fails
        return {
            hostname: url,
            port: undefined,
            isCustom
        };
    }
}

export function validateServerUrl(url: string): { valid: boolean; error?: string } {
    if (!url || !url.trim()) {
        return { valid: false, error: 'Server URL cannot be empty' };
    }
    
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { valid: false, error: 'Server URL must use HTTP or HTTPS protocol' };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }
}
