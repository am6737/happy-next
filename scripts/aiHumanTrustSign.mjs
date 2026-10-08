import { constants, openSync, fstatSync, readFileSync, closeSync, writeFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline operator utility. Never performs enrollment, HTTP requests or key generation.
export function parseApproval(value, now = Date.now()) {
    const fields = ['accountId', 'credentialId', 'approvalNonce', 'actorLabel', 'evidenceHash', 'expiresAt'];
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== fields.length
        || fields.some(field => typeof value[field] !== 'string')) throw new Error('APPROVAL_INVALID');
    for (const field of ['accountId', 'credentialId']) {
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(value[field])) throw new Error('APPROVAL_INVALID');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.approvalNonce)
        || value.actorLabel !== value.actorLabel.trim() || value.actorLabel.length < 3
        || value.actorLabel.length > 200 || /[\x00-\x1f\x7f]/.test(value.actorLabel)
        || !/^[0-9a-f]{64}$/.test(value.evidenceHash)
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.expiresAt)) {
        throw new Error('APPROVAL_INVALID');
    }
    const deadline = Date.parse(value.expiresAt);
    if (!Number.isFinite(deadline) || deadline <= now || deadline > now + 300_000) {
        throw new Error('APPROVAL_EXPIRED_OR_TOO_LONG');
    }
    // Server verifies this exact property order; do not sign input JSON bytes.
    return Object.fromEntries(fields.map(field => [field, value[field]]));
}

export function parseApprovalJson(raw, now = Date.now()) {
    // Approvals are a flat object of strings. Parse original member names
    // before materializing an object: JSON.parse silently keeps the last
    // duplicate, including names equivalent after Unicode escape decoding.
    let cursor = 0;
    const whitespace = () => { while (/[\x20\t\r\n]/.test(raw[cursor] ?? '') && cursor < raw.length) cursor++; };
    const invalid = () => { throw new Error('APPROVAL_JSON_INVALID'); };
    const string = () => {
        whitespace();
        if (raw[cursor] !== '"') return invalid();
        const start = cursor++;
        while (cursor < raw.length) {
            if (raw[cursor] === '\\') { cursor += 2; continue; }
            if (raw[cursor++] === '"') {
                try { return JSON.parse(raw.slice(start, cursor)); } catch { return invalid(); }
            }
        }
        return invalid();
    };
    const members = Object.create(null);
    whitespace(); if (raw[cursor++] !== '{') return invalid();
    whitespace();
    if (raw[cursor] !== '}') {
        while (true) {
            const name = string();
            if (Object.hasOwn(members, name)) throw new Error('APPROVAL_DUPLICATE_MEMBER');
            whitespace(); if (raw[cursor++] !== ':') return invalid();
            members[name] = string();
            whitespace();
            if (raw[cursor] === '}') break;
            if (raw[cursor++] !== ',') return invalid();
        }
    }
    cursor++; whitespace();
    if (cursor !== raw.length) return invalid();
    return parseApproval(members, now);
}

function privateFile(path, maximum) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > maximum || stat.size === 0
            || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
            throw new Error('PRIVATE_FILE_INVALID');
        }
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(fd));
    } finally { closeSync(fd); }
}

export function signApproval({ keyFile, approvalFile, outputFile }) {
    const approval = parseApprovalJson(privateFile(approvalFile, 16_384));
    const key = createPrivateKey(privateFile(keyFile, 16_384));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('KEY_MUST_BE_ED25519');
    const bytes = Buffer.from(JSON.stringify(approval));
    const signature = sign(null, bytes, key).toString('base64url');
    if (!verify(null, bytes, createPublicKey(key), Buffer.from(signature, 'base64url'))) {
        throw new Error('SIGNATURE_SELF_CHECK_FAILED');
    }
    parseApproval(approval); // Recheck the deadline after private-key loading/signing.
    writeFileSync(outputFile, `${JSON.stringify({ approval, signature }, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 });
    return { approval, signature };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2);
        if (args.length !== 6 || args[0] !== '--private-key' || args[2] !== '--approval' || args[4] !== '--out') {
            throw new Error('Usage: node scripts/aiHumanTrustSign.mjs --private-key PEM --approval JSON --out NEW_JSON');
        }
        signApproval({ keyFile: args[1], approvalFile: args[3], outputFile: args[5] });
        console.log('OFFLINE_HUMAN_TRUST_APPROVAL_SIGNED');
    } catch {
        // Node crypto/fs errors can contain private-key text or identifying paths.
        console.error('OFFLINE_HUMAN_TRUST_SIGN_FAILED: check arguments, private files, Ed25519 key and approval deadline');
        process.exitCode = 1;
    }
}
