import { decryptBox, decryptSecretBox, encryptBox, encryptSecretBox } from "@/encryption/libsodium";
import { encodeBase64, decodeBase64 } from "@/encryption/base64";
import sodium from '@/encryption/libsodium.lib';
import { decodeUTF8, encodeUTF8 } from "@/encryption/text";
import { decryptAESGCMString, encryptAESGCMString } from "@/encryption/aes";

//
// IMPORTANT: Right now there is a bug in the AES implementation and it works only with a normal strings converted to Uint8Array. 
// Any abnormal string might break encoding and decoding utf8.
//

export interface Encryptor {
    encrypt(data: any[]): Promise<Uint8Array[]>;
}

export interface Decryptor {
    decrypt(data: Uint8Array[]): Promise<(any | null)[]>;
}

export class SecretBoxEncryption implements Encryptor, Decryptor {
    private readonly secretKey: Uint8Array;

    constructor(secretKey: Uint8Array) {
        this.secretKey = secretKey;
    }

    async decrypt(data: Uint8Array[]): Promise<(any | null)[]> {
        // Process as batch, not Promise.all - more efficient
        const results: (any | null)[] = [];
        for (const item of data) {
            results.push(decryptSecretBox(item, this.secretKey));
        }
        return results;
    }

    async encrypt(data: any[]): Promise<Uint8Array[]> {
        // Process as batch, not Promise.all - more efficient
        const results: Uint8Array[] = [];
        for (const item of data) {
            results.push(encryptSecretBox(item, this.secretKey));
        }
        return results;
    }
}

export class BoxEncryption implements Encryptor, Decryptor {
    private readonly privateKey: Uint8Array;
    private readonly publicKey: Uint8Array;

    constructor(seed: Uint8Array) {
        // Use the seed to generate a proper keypair
        const keypair = sodium.crypto_box_seed_keypair(seed);
        this.privateKey = keypair.privateKey;
        this.publicKey = keypair.publicKey;
    }

    async encrypt(data: any[]): Promise<Uint8Array[]> {
        // Process as batch, not Promise.all - more efficient
        const results: Uint8Array[] = [];
        for (const item of data) {
            results.push(encryptBox(encodeUTF8(JSON.stringify(item)), this.publicKey));
        }
        return results;
    }

    async decrypt(data: Uint8Array[]): Promise<(any | null)[]> {
        // Process as batch, not Promise.all - more efficient
        const results: (any | null)[] = [];
        for (const item of data) {
            let decrypted = decryptBox(item, this.privateKey);
            if (!decrypted) {
                results.push(null);
                continue;
            }
            results.push(JSON.parse(decodeUTF8(decrypted)));
        }
        return results;
    }
}

export class AES256Encryption implements Encryptor, Decryptor {
    private readonly secretKey: Uint8Array;
    private readonly secretKeyB64: string;

    constructor(secretKey: Uint8Array) {
        this.secretKey = secretKey;
        this.secretKeyB64 = encodeBase64(secretKey);
    }

    async encrypt(data: any[]): Promise<Uint8Array[]> {
        // Process as batch, not Promise.all - more efficient
        const results: Uint8Array[] = [];
        for (const item of data) {
            // Serialize to JSON string first
            const encrypted = decodeBase64(await encryptAESGCMString(JSON.stringify(item), this.secretKeyB64));
            let output = new Uint8Array(encrypted.length + 1);
            output[0] = 0;
            output.set(encrypted, 1);
            results.push(output);
        }
        return results;
    }

    async decrypt(data: Uint8Array[]): Promise<(any | null)[]> {
        const results: (any | null)[] = [];
        // The native call costs ~3 ms per message and is dominated by bridge overhead for a ~9 KB
        // payload, not by the AES work itself (measured on a 100-message page: base64 6 ms, native
        // waits 326 ms, JSON.parse 3 ms). The native side runs on the IO dispatcher, so the calls
        // are issued together and awaited as one batch instead of one at a time. Chunked so a
        // pathological batch cannot put thousands of concurrent calls on the native pool.
        const CHUNK = 32;
        for (let start = 0; start < data.length; start += CHUNK) {
            const chunk = data.slice(start, start + CHUNK);
            const chunkResults = await Promise.all(chunk.map(async (item): Promise<any | null> => {
                try {
                    if (item[0] !== 0) {
                        return null;
                    }
                    const decryptedString = await decryptAESGCMString(encodeBase64(item.slice(1)), this.secretKeyB64);
                    // Parse JSON string back to object
                    return decryptedString ? JSON.parse(decryptedString) : null;
                } catch (error) {
                    return null;
                }
            }));
            for (const result of chunkResults) {
                results.push(result);
            }
        }
        return results;
    }
}