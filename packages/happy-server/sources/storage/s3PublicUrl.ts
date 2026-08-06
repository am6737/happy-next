const LOOPBACK_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', '::1', '[::]', '[::1]']);

function parseHttpUrl(value: string | undefined, name: string): URL {
    const trimmed = value?.trim();
    if (!trimmed) {
        throw new Error(`${name} is required`);
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`${name} must be a valid absolute URL`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${name} must use http or https`);
    }

    return parsed;
}

export function isLoopbackUrl(value: string | undefined): boolean {
    if (!value?.trim()) return false;

    try {
        const hostname = new URL(value.trim()).hostname.toLowerCase();
        if (LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
            return true;
        }

        const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        return ipv4 ? Number(ipv4[1]) === 127 : false;
    } catch {
        return false;
    }
}

function hasExternallyAddressedService(env: NodeJS.ProcessEnv): boolean {
    return [env.PUBLIC_API_BASE_URL, env.APP_URL]
        .some((value) => value?.trim() && !isLoopbackUrl(value));
}

/**
 * Validate and normalize the base URL embedded in legacy chat image messages.
 * A loopback URL is valid for an all-local development deployment, but is never
 * reachable by clients when the server itself advertises an external address.
 */
export function validateS3PublicUrl(env: NodeJS.ProcessEnv = process.env): string {
    const parsed = parseHttpUrl(env.S3_PUBLIC_URL, 'S3_PUBLIC_URL');
    const normalized = parsed.toString().replace(/\/+$/, '');

    if (
        env.NODE_ENV === 'production'
        && isLoopbackUrl(normalized)
        && hasExternallyAddressedService(env)
    ) {
        throw new Error(
            'S3_PUBLIC_URL points to a loopback address in an externally addressed production deployment. '
            + 'Set it to an HTTP(S) URL reachable by desktop, web, and mobile clients.'
        );
    }

    return normalized;
}
