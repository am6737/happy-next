#!/usr/bin/env tsx
/**
 * Publishes OTA updates of the app's JS to our own server (happy-server otaRoutes), which the
 * app's expo-updates polls (app.config.js updates.url). Only JS and assets ship this way: an
 * update reaches only builds whose native side matches, as the runtime version is the
 * native fingerprint (fingerprint.config.js).
 *
 *   yarn ota publish [--channel production] [--platform all|ios|android] [--message "..."]
 *   yarn ota list [--channel production] [--platform ios|android]
 *   yarn ota republish <update id> [--message "..."]      roll back to an earlier update
 *   yarn ota rollback-to-embedded --platform ios|android [--channel production]
 *                                                           back to the JS in the binary
 *
 * OTA_ADMIN_TOKEN must match the server's; OTA_SERVER_URL defaults to https://api.happy-next.com.
 * publish pulls the channel's EAS environment (EXPO_PUBLIC_*) like a build does, unless
 * --env-file gives one.
 */

import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const APP_DIR = path.join(__dirname, '../..');
const SERVER = (process.env.OTA_SERVER_URL || 'https://api.happy-next.com').replace(/\/+$/, '');
const PLATFORMS = ['ios', 'android'] as const;
type Platform = typeof PLATFORMS[number];

const CONTENT_TYPES: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
    json: 'application/json', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4',
    html: 'text/html', css: 'text/css', js: 'application/javascript', wasm: 'application/wasm',
};

type Asset = { hash: string; key: string; fileExtension: string; contentType: string; file: string };

function die(message: string): never {
    console.error(`ota: ${message}`);
    process.exit(1);
}

function parseArgs(argv: string[]) {
    const positional: string[] = [];
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const value = argv[i + 1];
            if (value === undefined || value.startsWith('--')) die(`${arg} needs a value`);
            flags[arg.slice(2)] = value;
            i++;
        } else {
            positional.push(arg);
        }
    }
    return { positional, flags };
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, capture = false) {
    return execFileSync(cmd, args, {
        cwd: APP_DIR,
        env,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
}

function token() {
    const value = process.env.OTA_ADMIN_TOKEN?.trim();
    if (!value) die('set OTA_ADMIN_TOKEN to the server\'s token');
    return value;
}

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
    const response = await fetch(SERVER + route, {
        method,
        headers: {
            authorization: `Bearer ${token()}`,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) die(`${method} ${route} → ${response.status} ${text}`);
    return JSON.parse(text) as T;
}

function parseEnvFile(file: string) {
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        let value = match[2];
        if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
        env[match[1]] = value;
    }
    return env;
}

/** The channel's build env: APP_ENV picks the variant in app.config.js, the rest is EAS's */
function buildEnv(channel: string, envFile: string | undefined, tmp: string): NodeJS.ProcessEnv {
    let file = envFile;
    if (!file) {
        file = path.join(tmp, 'eas.env');
        console.log(`→ eas env:pull ${channel}`);
        run('npx', ['eas-cli', 'env:pull', channel, '--path', file, '--non-interactive'], process.env);
    }
    return { ...process.env, ...parseEnvFile(file), APP_ENV: channel, NODE_ENV: 'production', CI: '1' };
}

function fileAsset(file: string, ext: string): Asset {
    const data = fs.readFileSync(file);
    return {
        hash: createHash('sha256').update(data).digest('base64url'),
        key: createHash('md5').update(data).digest('hex'),
        fileExtension: `.${ext}`,
        contentType: CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream',
        file,
    };
}

async function uploadMissing(assets: Asset[]) {
    const byHash = new Map(assets.map((a) => [a.hash, a]));
    const { missing } = await api<{ missing: string[] }>('POST', '/v1/ota/assets/missing', { hashes: [...byHash.keys()] });
    console.log(`  ${byHash.size} files, ${missing.length} to upload`);
    const queue = [...missing];
    const worker = async () => {
        for (let hash = queue.shift(); hash; hash = queue.shift()) {
            const asset = byHash.get(hash)!;
            const data = fs.readFileSync(asset.file);
            const response = await fetch(
                `${SERVER}/v1/ota/assets/${hash}?contentType=${encodeURIComponent(asset.contentType)}`,
                {
                    method: 'PUT',
                    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/octet-stream' },
                    body: data,
                },
            );
            if (!response.ok) die(`upload of ${path.basename(asset.file)} → ${response.status} ${await response.text()}`);
        }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
}

function runtimeVersion(platform: Platform, env: NodeJS.ProcessEnv) {
    const out = run('npx', ['expo-updates', 'runtimeversion:resolve', '--platform', platform], env, true);
    const value = JSON.parse(out.trim().split('\n').pop()!).runtimeVersion;
    if (typeof value !== 'string' || !value) die(`no runtime version for ${platform}`);
    return value;
}

async function publish(flags: Record<string, string>) {
    const channel = flags.channel ?? 'production';
    const platforms: Platform[] = !flags.platform || flags.platform === 'all'
        ? [...PLATFORMS]
        : PLATFORMS.includes(flags.platform as Platform) ? [flags.platform as Platform] : die(`unknown platform ${flags.platform}`);
    const gitCommit = run('git', ['rev-parse', 'HEAD'], process.env, true).trim();
    if (run('git', ['status', '--porcelain', '--untracked-files=no'], process.env, true).trim()) {
        console.warn('ota: warning: the working tree has uncommitted changes, which go into the update');
    }
    token();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-ota-'));
    try {
        const env = buildEnv(channel, flags['env-file'], tmp);
        const dist = path.join(tmp, 'dist');
        console.log(`→ expo export (${platforms.join(', ')})`);
        run('npx', ['expo', 'export', ...platforms.flatMap((p) => ['--platform', p]), '--output-dir', dist], env);
        const expoClient = JSON.parse(run('npx', ['expo', 'config', '--type', 'public', '--json'], env, true));
        const metadata = JSON.parse(fs.readFileSync(path.join(dist, 'metadata.json'), 'utf8'));

        for (const platform of platforms) {
            const files = metadata.fileMetadata?.[platform];
            if (!files?.bundle) die(`expo export wrote no ${platform} bundle`);
            const runtime = runtimeVersion(platform, env);
            console.log(`→ ${platform}: runtime ${runtime}`);
            const launch = fileAsset(path.join(dist, files.bundle), 'bundle');
            launch.contentType = 'application/javascript';
            const assets: Asset[] = files.assets.map((a: { path: string; ext: string }) => fileAsset(path.join(dist, a.path), a.ext));
            await uploadMissing([launch, ...assets]);

            const id = randomUUID();
            const strip = ({ file: _, ...a }: Asset) => a;
            await api('POST', '/v1/ota/updates', {
                id,
                channel,
                platform,
                runtimeVersion: runtime,
                message: flags.message ?? null,
                gitCommit,
                launchAsset: strip(launch),
                assets: assets.map(strip),
                expoClient,
            });
            console.log(`✓ ${platform} update ${id} published to ${channel}`);
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

type UpdateListItem = {
    id: string; channel: string; platform: string; runtimeVersion: string; kind: string;
    message: string | null; gitCommit: string | null; republishedFrom: string | null; createdAt: number;
};

async function list(flags: Record<string, string>) {
    const query = new URLSearchParams();
    if (flags.channel) query.set('channel', flags.channel);
    if (flags.platform) query.set('platform', flags.platform);
    if (flags.limit) query.set('limit', flags.limit);
    const { updates } = await api<{ updates: UpdateListItem[] }>('GET', `/v1/ota/updates?${query}`);
    for (const u of updates) {
        const what = u.kind === 'update'
            ? (u.republishedFrom ? `republish of ${u.republishedFrom}` : `commit ${u.gitCommit?.slice(0, 8) ?? '-'}`)
            : u.kind;
        console.log(`${new Date(u.createdAt).toISOString()}  ${u.id}  ${u.channel}/${u.platform}  runtime ${u.runtimeVersion.slice(0, 12)}  ${what}${u.message ? `  "${u.message}"` : ''}`);
    }
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);
    const { positional, flags } = parseArgs(rest);
    switch (command) {
        case 'publish':
            return publish(flags);
        case 'list':
            return list(flags);
        case 'republish': {
            const id = positional[0] ?? die('give the id of the update to republish (yarn ota list)');
            const newId = randomUUID();
            await api('POST', `/v1/ota/updates/${id}/republish`, { newId, message: flags.message ?? null });
            console.log(`✓ republished ${id} as ${newId}`);
            return;
        }
        case 'rollback-to-embedded': {
            const platform = flags.platform as Platform;
            if (!PLATFORMS.includes(platform)) die('give --platform ios or --platform android');
            const channel = flags.channel ?? 'production';
            // The runtime version of the builds to roll back is the current code's, under the
            // channel's build env like publish's (EAS env decides e.g. whether DooPush is in)
            let runtime = flags.runtime;
            if (!runtime) {
                const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-ota-'));
                try {
                    runtime = runtimeVersion(platform, buildEnv(channel, flags['env-file'], tmp));
                } finally {
                    fs.rmSync(tmp, { recursive: true, force: true });
                }
            }
            const id = randomUUID();
            await api('POST', '/v1/ota/rollback-to-embedded', { id, channel, platform, runtimeVersion: runtime, message: flags.message ?? null });
            console.log(`✓ ${channel}/${platform} runtime ${runtime} rolled back to the embedded JS`);
            return;
        }
        default:
            die('usage: yarn ota publish|list|republish|rollback-to-embedded (see sources/scripts/ota.ts)');
    }
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));
