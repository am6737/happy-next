import { MMKV } from 'react-native-mmkv';

// Separate MMKV instance for server config that persists across logouts
const serverConfigStorage = new MMKV({ id: 'server-config' });

const SERVER_KEY = 'custom-server-url';
const DEFAULT_SERVER_URLS = [
    'https://api.happy-next.com',
    'https://api-happy-next.dootask.com',
] as const;
const APP_CONFIG_PATH = '/v1/app-config';
const STARTUP_DISCOVERY_WAIT_MS = 5000;
const DISCOVERY_REQUEST_TIMEOUT_MS = 30_000;
const DISCOVERY_RETRY_DELAY_MS = 15_000;

interface RemoteAppConfigResponse {
    apiBaseUrl?: unknown;
    voice?: {
        baseUrl?: unknown;
    } | null;
}

interface ResolvedVoiceConfig {
    baseUrl?: string;
}

let resolvedServerUrl: string | null = null;
let resolvedVoiceConfig: ResolvedVoiceConfig = {};
let resolvePromise: Promise<void> | null = null;
let discoveryPromise: Promise<void> | null = null;
let discoveryGeneration = 0;
const activeDiscoveryControllers = new Set<AbortController>();
const serverUrlListeners = new Set<(serverUrl: string) => void>();

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

export function getCustomServerUrl(): string | null {
    return normalizeUrl(serverConfigStorage.getString(SERVER_KEY));
}

function getConfiguredServerEntryUrl(): string | null {
    return normalizeUrl(process.env.EXPO_PUBLIC_HAPPY_SERVER_URL_OVERRIDE)
        || getCustomServerUrl()
        || normalizeUrl(process.env.EXPO_PUBLIC_HAPPY_SERVER_URL);
}

export function getServerEntryUrl(): string {
    return getConfiguredServerEntryUrl() || DEFAULT_SERVER_URLS[0];
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRemoteAppConfig(
    entryServerUrl: string,
    controller: AbortController = new AbortController(),
): Promise<RemoteAppConfigResponse | null> {
    activeDiscoveryControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_REQUEST_TIMEOUT_MS);
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
        if (!(error instanceof Error && error.name === 'AbortError')) {
            console.warn('[serverConfig] Failed to fetch remote app config:', error);
        }
        return null;
    } finally {
        clearTimeout(timeout);
        activeDiscoveryControllers.delete(controller);
    }
}

async function fetchDefaultAppConfig(): Promise<{ entryServerUrl: string; remoteConfig: RemoteAppConfigResponse } | null> {
    return new Promise((resolve) => {
        let pending = DEFAULT_SERVER_URLS.length;
        let settled = false;
        const controllers = DEFAULT_SERVER_URLS.map(() => new AbortController());

        DEFAULT_SERVER_URLS.forEach((entryServerUrl, index) => {
            fetchRemoteAppConfig(entryServerUrl, controllers[index]).then((remoteConfig) => {
                if (settled) return;
                if (remoteConfig) {
                    settled = true;
                    controllers.forEach((controller, controllerIndex) => {
                        if (controllerIndex !== index) controller.abort();
                    });
                    resolve({ entryServerUrl, remoteConfig });
                    return;
                }

                pending -= 1;
                if (pending === 0) {
                    settled = true;
                    resolve(null);
                }
            });
        });
    });
}

async function discoverServerConfig(): Promise<{ entryServerUrl: string; remoteConfig: RemoteAppConfigResponse } | null> {
    const configuredEntryServerUrl = getConfiguredServerEntryUrl();
    if (!configuredEntryServerUrl) {
        return fetchDefaultAppConfig();
    }

    const remoteConfig = await fetchRemoteAppConfig(configuredEntryServerUrl);
    return remoteConfig ? { entryServerUrl: configuredEntryServerUrl, remoteConfig } : null;
}

function applyRemoteConfig(entryServerUrl: string, remoteConfig: RemoteAppConfigResponse): void {
    const previousServerUrl = getServerUrl();
    const remoteApiBaseUrl = normalizeUrl(normalizeString(remoteConfig.apiBaseUrl));
    resolvedServerUrl = remoteApiBaseUrl || entryServerUrl;
    resolvedVoiceConfig = {
        baseUrl: normalizeUrl(normalizeString(remoteConfig.voice?.baseUrl)) || undefined,
    };

    if (resolvedServerUrl !== previousServerUrl) {
        serverUrlListeners.forEach((listener) => listener(resolvedServerUrl!));
    }
}

function startServerDiscovery(generation: number): Promise<void> {
    if (discoveryPromise) return discoveryPromise;

    discoveryPromise = (async () => {
        while (generation === discoveryGeneration) {
            const result = await discoverServerConfig();
            if (generation !== discoveryGeneration) return;
            if (result) {
                applyRemoteConfig(result.entryServerUrl, result.remoteConfig);
                return;
            }

            await delay(DISCOVERY_RETRY_DELAY_MS);
        }
    })();

    return discoveryPromise;
}

export async function resolveServerConfig(): Promise<void> {
    if (resolvePromise) return resolvePromise;

    resolvePromise = (async () => {
        const generation = discoveryGeneration;
        const discovery = startServerDiscovery(generation);
        await Promise.race([
            discovery,
            delay(STARTUP_DISCOVERY_WAIT_MS),
        ]);

        // getServerUrl() already falls back to the configured entry or first default
        // while discovery continues in the background.
    })();

    return resolvePromise;
}

export function getServerUrl(): string {
    return resolvedServerUrl || getServerEntryUrl();
}

export function getDiscoveredVoiceConfig(): ResolvedVoiceConfig {
    return resolvedVoiceConfig;
}

export function onServerUrlChanged(listener: (serverUrl: string) => void): () => void {
    serverUrlListeners.add(listener);
    return () => serverUrlListeners.delete(listener);
}

export function setServerUrl(url: string | null): void {
    if (url && url.trim()) {
        serverConfigStorage.set(SERVER_KEY, url.trim());
    } else {
        serverConfigStorage.delete(SERVER_KEY);
    }
    resolvedServerUrl = null;
    resolvedVoiceConfig = {};
    discoveryGeneration += 1;
    activeDiscoveryControllers.forEach((controller) => controller.abort());
    activeDiscoveryControllers.clear();
    resolvePromise = null;
    discoveryPromise = null;
}

export function hasCustomServerUrl(): boolean {
    return getCustomServerUrl() != null;
}

export function isUsingCustomServer(): boolean {
    return hasCustomServerUrl();
}

export function getServerInfo(): { hostname: string; port?: number; isCustom: boolean; entryUrl: string; resolvedUrl: string } {
    const url = getServerUrl();
    const isCustom = hasCustomServerUrl();
    
    try {
        const parsed = new URL(url);
        const port = parsed.port ? parseInt(parsed.port) : undefined;
        return {
            hostname: parsed.hostname,
            port,
            isCustom,
            entryUrl: getServerEntryUrl(),
            resolvedUrl: url,
        };
    } catch {
        // Fallback if URL parsing fails
        return {
            hostname: url,
            port: undefined,
            isCustom,
            entryUrl: getServerEntryUrl(),
            resolvedUrl: url,
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
