export interface DesktopNativeDiagnostics {
    appName: string;
    appVersion: string;
    identifier: string;
    operatingSystem: string;
    architecture: string;
    buildProfile: string;
    logDirectory: string;
}

export interface DesktopDiagnosticsSnapshot {
    native: DesktopNativeDiagnostics;
    server: {
        entryUrl: string;
        resolvedUrl: string;
        isCustom: boolean;
    };
    socket: {
        status: 'disconnected' | 'connecting' | 'connected' | 'error';
        lastConnectedAt: number | null;
        lastDisconnectedAt: number | null;
    };
    webviewUserAgent: string;
}

export function sanitizeDiagnosticUrl(value: string): string {
    try {
        const url = new URL(value);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return 'invalid-url';
    }
}

function formatTimestamp(value: number | null): string {
    return value ? new Date(value).toISOString() : 'never';
}

export function formatDesktopDiagnostics(snapshot: DesktopDiagnosticsSnapshot): string {
    return [
        `${snapshot.native.appName} ${snapshot.native.appVersion}`,
        `Identifier: ${snapshot.native.identifier}`,
        `Platform: ${snapshot.native.operatingSystem} (${snapshot.native.architecture})`,
        `Build: ${snapshot.native.buildProfile}`,
        `Server entry: ${sanitizeDiagnosticUrl(snapshot.server.entryUrl)}`,
        `Server resolved: ${sanitizeDiagnosticUrl(snapshot.server.resolvedUrl)}`,
        `Custom server: ${snapshot.server.isCustom ? 'yes' : 'no'}`,
        `Socket: ${snapshot.socket.status}`,
        `Last connected: ${formatTimestamp(snapshot.socket.lastConnectedAt)}`,
        `Last disconnected: ${formatTimestamp(snapshot.socket.lastDisconnectedAt)}`,
        `WebView: ${snapshot.webviewUserAgent || 'unknown'}`,
        `Log directory: ${snapshot.native.logDirectory}`,
    ].join('\n');
}
