import { describe, expect, it } from 'vitest';
import { encodeBase64, encryptWithDataKey } from '@/api/encryption';
import { createChannelCrypto, decryptChannelMessage, encryptChannelMessage } from './channelCrypto';

const machineKey = new Uint8Array(32).fill(17);
const key = new Uint8Array(32).fill(31);
const wrap = (value = key) => encodeBase64(encryptWithDataKey({ k: encodeBase64(value) }, machineKey));

describe('channel encryption', () => {
    it('unwraps a machine-wrapped key and caches it per channel, refreshing changed wraps', () => {
        const crypto = createChannelCrypto(machineKey);
        const wrapped = wrap();
        expect(crypto.unwrap('channel', wrapped)).toEqual(key);
        expect(crypto.unwrap('channel', wrapped)).toBe(crypto.unwrap('channel', wrapped));
        expect(crypto.unwrap('channel', wrap(new Uint8Array(32).fill(8)))).toEqual(new Uint8Array(32).fill(8));
    });
    it('round trips message text, decision options and report links', () => {
        const body = { text: '做了什么：完成', options: [{ id: 'yes', label: '继续' }], links: [{ kind: 'session' as const, sessionId: 's1' }] };
        expect(decryptChannelMessage(encryptChannelMessage(body, key), key)).toEqual(body);
    });
    it('fails clearly with a wrong machine or channel key and malformed keys', () => {
        expect(() => createChannelCrypto(new Uint8Array(32)).unwrap('channel', wrap())).toThrow('unwrap channel key');
        expect(() => decryptChannelMessage(encryptChannelMessage({ text: 'secret' }, key), new Uint8Array(32))).toThrow('decrypt channel message');
        expect(() => createChannelCrypto(machineKey).unwrap('channel', wrap(new Uint8Array(31)))).toThrow('unwrap channel key');
        expect(() => createChannelCrypto(null).unwrap('channel', wrap())).toThrow('machine credentials');
    });
});
