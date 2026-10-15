import { deriveKey } from "@/encryption/deriveKey";
import { AES256Encryption, BoxEncryption, SecretBoxEncryption, Encryptor, Decryptor } from "./encryptor";
import { encodeHex } from "@/encryption/hex";
import { EncryptionCache } from "./encryptionCache";
import { SessionEncryption } from "./sessionEncryption";
import { MachineEncryption } from "./machineEncryption";
import { encodeBase64, decodeBase64 } from "@/encryption/base64";
import sodium from '@/encryption/libsodium.lib';
import { decryptBox, encryptBox } from "@/encryption/libsodium";
import { randomUUID } from 'expo-crypto';

export class Encryption {

    static async create(masterSecret: Uint8Array) {

        // Derive content data key to open session and machine records
        const contentDataKey = await deriveKey(masterSecret, 'Happy EnCoder', ['content']);

        // Derive content data key keypair
        const contentKeyPair = sodium.crypto_box_seed_keypair(contentDataKey);

        // Derive anonymous ID
        const anonID = encodeHex((await deriveKey(masterSecret, 'Happy Coder', ['analytics', 'id']))).slice(0, 16).toLowerCase();

        // Derive the orchestrator key, which seals orchestrator tasks end to end; CLIs signed in
        // with the account's secret derive the same, the others get it from the app (see sync.ts)
        const orchestratorKey = await deriveKey(masterSecret, 'Happy Orchestrator', ['key']);

        // Create encryption
        return new Encryption(anonID, masterSecret, contentKeyPair, orchestratorKey);
    }

    private readonly legacyEncryption: SecretBoxEncryption;
    private readonly contentKeyPair: sodium.KeyPair;
    private readonly masterSecret: Uint8Array;
    readonly anonID: string;
    readonly contentDataKey: Uint8Array;
    readonly orchestratorKey: Uint8Array;
    private readonly orchestratorEncryption: AES256Encryption;

    // Session and machine encryption management
    private sessionEncryptions = new Map<string, SessionEncryption>();
    private machineEncryptions = new Map<string, MachineEncryption>();
    private cache: EncryptionCache;

    private constructor(anonID: string, masterSecret: Uint8Array, contentKeyPair: sodium.KeyPair, orchestratorKey: Uint8Array) {
        this.anonID = anonID;
        this.contentKeyPair = contentKeyPair;
        this.masterSecret = masterSecret;
        this.legacyEncryption = new SecretBoxEncryption(masterSecret);
        this.cache = new EncryptionCache();
        this.contentDataKey = contentKeyPair.publicKey;
        this.orchestratorKey = orchestratorKey;
        this.orchestratorEncryption = new AES256Encryption(orchestratorKey);
    }

    /**
     * Opens what orchestrator tasks carry sealed (`e2e1:` and the base64 of an AES-256-GCM bundle):
     * an entry per value, null for one that is not sealed or not with the account's key.
     */
    async openOrchestrator(values: unknown[]): Promise<(any | null)[]> {
        const sealed = values.map((value) => {
            try {
                return typeof value === 'string' && value.startsWith('e2e1:')
                    ? decodeBase64(value.slice('e2e1:'.length))
                    : new Uint8Array(0);
            } catch {
                return new Uint8Array(0);
            }
        });
        return this.orchestratorEncryption.decrypt(sealed);
    }

    //
    // Core encryption opening
    //

    async openEncryption(dataEncryptionKey: Uint8Array | null): Promise<Encryptor & Decryptor> {
        if (!dataEncryptionKey) {
            return this.legacyEncryption;
        }
        return new AES256Encryption(dataEncryptionKey);
    }

    //
    // Session operations
    //

    /**
     * Initialize sessions with their encryption keys
     * This should be called once when sessions are loaded
     */
    async initializeSessions(sessions: Map<string, Uint8Array | null>): Promise<void> {
        for (const [sessionId, dataKey] of sessions) {
            // Skip if already initialized
            if (this.sessionEncryptions.has(sessionId)) {
                continue;
            }

            // Create appropriate encryptor based on data key
            const encryptor = await this.openEncryption(dataKey);

            // Create and cache session encryption
            const sessionEnc = new SessionEncryption(
                sessionId,
                encryptor,
                this.cache
            );
            this.sessionEncryptions.set(sessionId, sessionEnc);
        }
    }

    /**
     * Get session encryption if it has been initialized
     * Returns null if not initialized (should never happen in normal flow)
     */
    getSessionEncryption(sessionId: string): SessionEncryption | null {
        return this.sessionEncryptions.get(sessionId) || null;
    }

    /**
     * Remove session encryption from memory when session is deleted
     */
    removeSessionEncryption(sessionId: string): void {
        this.sessionEncryptions.delete(sessionId);
        // Also clear any cached data for this session
        this.cache.clearSessionCache(sessionId);
    }

    //
    // Machine operations
    //

    /**
     * Initialize machines with their encryption keys
     * This should be called once when machines are loaded
     */
    async initializeMachines(machines: Map<string, Uint8Array | null>): Promise<void> {
        for (const [machineId, dataKey] of machines) {
            // Skip if already initialized
            if (this.machineEncryptions.has(machineId)) {
                continue;
            }

            // Create appropriate encryptor based on data key
            const encryptor = await this.openEncryption(dataKey);

            // For legacy decryption, use the appropriate key:
            // - If dataKey exists, use dataKey (machine-specific key)
            // - Otherwise, use masterSecret (legacy mode)
            const legacyKey = dataKey ?? this.masterSecret;

            // Create and cache machine encryption
            const machineEnc = new MachineEncryption(
                machineId,
                encryptor,
                this.cache,
                legacyKey
            );
            this.machineEncryptions.set(machineId, machineEnc);
        }
    }

    /**
     * Get machine encryption if it has been initialized
     * Returns null if not initialized (should never happen in normal flow)
     */
    getMachineEncryption(machineId: string): MachineEncryption | null {
        return this.machineEncryptions.get(machineId) || null;
    }

    //
    // Legacy methods for machine metadata (temporary until machines are migrated)
    //

    async encryptRaw(data: any): Promise<string> {
        const encrypted = await this.legacyEncryption.encrypt([data]);
        return encodeBase64(encrypted[0], 'base64');
    }

    async decryptRaw(encrypted: string): Promise<any | null> {
        try {
            const encryptedData = decodeBase64(encrypted, 'base64');
            const decrypted = await this.legacyEncryption.decrypt([encryptedData]);
            return decrypted[0] || null;
        } catch (error) {
            return null;
        }
    }

    //
    // Data Encryption Key decryption
    //

    async decryptEncryptionKey(encrypted: string) {
        const encryptedKey = decodeBase64(encrypted, 'base64');
        if (encryptedKey[0] !== 0) {
            return null;
        }

        const decrypted = decryptBox(encryptedKey.slice(1), this.contentKeyPair.privateKey);
        if (!decrypted) {
            return null;
        }
        return decrypted;
    }

    async encryptEncryptionKey(key: Uint8Array): Promise<Uint8Array> {
        // Use public key for encryption (encrypt TO ourselves)
        const encrypted = encryptBox(key, this.contentKeyPair.publicKey);
        const result = new Uint8Array(encrypted.length + 1);
        result[0] = 0; // Version byte
        result.set(encrypted, 1);
        return result;
    }

    generateId(): string {
        return randomUUID();
    }
}