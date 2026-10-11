import { ChannelMessageBodySchema, type ChannelMessageBody } from 'happy-wire';
import { decodeBase64, encodeBase64, encryptWithDataKey, decryptWithDataKey } from '@/api/encryption';

/** Cache is scoped to a daemon runtime, and refreshes when the wrapped key changes. */
export function createChannelCrypto(machineKey: Uint8Array | null) {
    const keys = new Map<string, { wrapped: string; key: Uint8Array }>();
    return {
        unwrap(channelId: string, wrapped: string): Uint8Array {
            const cached = keys.get(channelId);
            if (cached?.wrapped === wrapped) return cached.key;
            if (!machineKey) throw new Error('Channel encryption requires dataKey machine credentials');
            const value = decryptWithDataKey(decodeBase64(wrapped), machineKey);
            if (!value || typeof value.k !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value.k)) {
                throw new Error('Unable to unwrap channel key with this machine key');
            }
            const key = decodeBase64(value.k);
            if (key.length !== 32) throw new Error('Channel key must be 32 bytes');
            keys.set(channelId, { wrapped, key });
            return key;
        },
    };
}

export function encryptChannelMessage(body: ChannelMessageBody, key: Uint8Array): string {
    return encodeBase64(encryptWithDataKey(ChannelMessageBodySchema.parse(body), key));
}

export function decryptChannelMessage(content: string, key: Uint8Array): ChannelMessageBody {
    const result = ChannelMessageBodySchema.safeParse(decryptWithDataKey(decodeBase64(content), key));
    if (!result.success) throw new Error('Unable to decrypt channel message with this channel key');
    return result.data;
}
