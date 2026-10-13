import { getRandomBytes } from 'expo-crypto';
import { ChannelBriefBodySchema, ChannelMessageBodySchema, type ChannelMessageBody } from 'happy-wire';
import { encodeBase64, decodeBase64 } from '@/encryption/base64';
import { encryptDataKeyForRecipientV0 } from './directShareEncryption';
import { AES256Encryption } from './encryption/encryptor';
import type { Encryption } from './encryption/encryption';

function requireKey(key: Uint8Array | null): Uint8Array {
    if (!key || key.length !== 32) throw new Error('Invalid channel or machine key');
    return key;
}
export function generateChannelKey(): Uint8Array { return getRandomBytes(32); }
export function wrapChannelKeyForAccount(key: Uint8Array, contentPublicKey: Uint8Array): string {
    return encryptDataKeyForRecipientV0(requireKey(key), encodeBase64(contentPublicKey));
}
export async function unwrapChannelKey(encryption: Pick<Encryption, 'decryptEncryptionKey'>, wrapped: string): Promise<Uint8Array> {
    return requireKey(await encryption.decryptEncryptionKey(wrapped));
}
export async function wrapChannelKeyForTeammate(key: Uint8Array, machineKey: Uint8Array): Promise<string> {
    const [encrypted] = await new AES256Encryption(requireKey(machineKey)).encrypt([{ k: encodeBase64(requireKey(key)) }]);
    return encodeBase64(encrypted);
}
export async function encryptChannelMessage(key: Uint8Array, body: ChannelMessageBody): Promise<{ t: 'encrypted'; c: string }> {
    const [encrypted] = await new AES256Encryption(requireKey(key)).encrypt([ChannelMessageBodySchema.parse(body)]);
    return { t: 'encrypted', c: encodeBase64(encrypted) };
}
export async function decryptChannelMessage(key: Uint8Array, content: { t: 'encrypted'; c: string }): Promise<ChannelMessageBody | null> {
    try {
        const [body] = await new AES256Encryption(requireKey(key)).decrypt([decodeBase64(content.c)]);
        const parsed = ChannelMessageBodySchema.safeParse(body);
        return parsed.success ? parsed.data : null;
    } catch { return null; }
}
export async function encryptChannelBrief(key: Uint8Array, text: string): Promise<string> {
    const [encrypted] = await new AES256Encryption(requireKey(key)).encrypt([ChannelBriefBodySchema.parse({ text })]);
    return encodeBase64(encrypted);
}
export async function decryptChannelBrief(key: Uint8Array, content: string): Promise<string | null> {
    try {
        const [body] = await new AES256Encryption(requireKey(key)).decrypt([decodeBase64(content)]);
        const parsed = ChannelBriefBodySchema.safeParse(body);
        return parsed.success ? parsed.data.text : null;
    } catch { return null; }
}
