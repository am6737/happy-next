const PUBLIC_ATTACHMENT_MAX_CONCURRENCY = 4;
const PUBLIC_ATTACHMENT_MAX_ATTEMPTS = 3;
const RETRY_JITTER_MS = 250;
const DEFAULT_RETRY_DELAY_MS = 1000;

type RequestLimiter = {
    run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
};

type DownloadDependencies = {
    fetch: typeof fetch;
    limiter: RequestLimiter;
    random: () => number;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
    now: () => number;
};

function abortError(): Error {
    const error = new Error('Attachment download aborted');
    error.name = 'AbortError';
    return error;
}

export function createAttachmentRequestLimiter(maxConcurrent: number): RequestLimiter {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
        throw new Error('maxConcurrent must be a positive integer');
    }

    let active = 0;
    const queue: Array<() => void> = [];

    const drain = () => {
        while (active < maxConcurrent && queue.length > 0) {
            queue.shift()?.();
        }
    };

    return {
        run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
            if (signal?.aborted) return Promise.reject(abortError());

            return new Promise<T>((resolve, reject) => {
                let started = false;
                const start = () => {
                    started = true;
                    signal?.removeEventListener('abort', onAbort);
                    active += 1;
                    void task().then(resolve, reject).finally(() => {
                        active -= 1;
                        drain();
                    });
                };
                const onAbort = () => {
                    if (started) return;
                    const index = queue.indexOf(start);
                    if (index >= 0) queue.splice(index, 1);
                    reject(abortError());
                };

                signal?.addEventListener('abort', onAbort, { once: true });
                queue.push(start);
                drain();
            });
        },
    };
}

export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const retryAt = Date.parse(value);
    if (!Number.isFinite(retryAt)) return null;
    return Math.max(0, retryAt - now);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const finish = () => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        };
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        const timer = setTimeout(finish, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

const publicAttachmentLimiter = createAttachmentRequestLimiter(PUBLIC_ATTACHMENT_MAX_CONCURRENCY);

export async function downloadPublicShareAttachmentBytes(
    url: string,
    options: { signal?: AbortSignal; resourceAccessToken?: string } = {},
    dependencyOverrides: Partial<DownloadDependencies> = {},
): Promise<Uint8Array> {
    const dependencies: DownloadDependencies = {
        fetch,
        limiter: publicAttachmentLimiter,
        random: Math.random,
        sleep,
        now: Date.now,
        ...dependencyOverrides,
    };

    for (let attempt = 0; attempt < PUBLIC_ATTACHMENT_MAX_ATTEMPTS; attempt += 1) {
        const result = await dependencies.limiter.run(async () => {
            const response = await dependencies.fetch(url, {
                signal: options.signal,
                headers: options.resourceAccessToken
                    ? { 'X-Public-Share-Access': options.resourceAccessToken }
                    : undefined,
            });
            if (response.ok) {
                return { kind: 'success', bytes: new Uint8Array(await response.arrayBuffer()) } as const;
            }

            const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), dependencies.now());
            await response.arrayBuffer().catch(() => undefined);
            return { kind: 'failure', status: response.status, retryAfterMs } as const;
        }, options.signal);

        if (result.kind === 'success') return result.bytes;
        if (result.status !== 429 || attempt === PUBLIC_ATTACHMENT_MAX_ATTEMPTS - 1) {
            throw new Error(`Download failed: ${result.status}`);
        }

        const fallbackDelay = DEFAULT_RETRY_DELAY_MS * (2 ** attempt);
        const delayMs = (result.retryAfterMs ?? fallbackDelay) + Math.floor(dependencies.random() * RETRY_JITTER_MS);
        await dependencies.sleep(delayMs, options.signal);
    }

    throw new Error('Attachment download failed');
}
