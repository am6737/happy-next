import { Platform } from 'react-native';

type PublicKeyOptions = Record<string, unknown>;

function decodeBase64Url(value: string): ArrayBuffer {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
}

function encodeBase64Url(value: ArrayBuffer): string {
    const bytes = new Uint8Array(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function supportsHumanCredential(): boolean {
    return Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.credentials
        && typeof PublicKeyCredential !== 'undefined' && window.isSecureContext;
}

function requireCredentialSupport(): void {
    if (!supportsHumanCredential()) throw new Error('This device cannot complete secure identity verification. Use a supported browser and device.');
}

export async function createHumanCredential(options: PublicKeyOptions): Promise<Record<string, unknown>> {
    requireCredentialSupport();
    const user = options.user as { id: string };
    const excludeCredentials = (options.excludeCredentials as Array<{ id: string }> | undefined) ?? [];
    const publicKey = { ...options, challenge: decodeBase64Url(options.challenge as string),
        user: { ...user, id: decodeBase64Url(user.id) },
        excludeCredentials: excludeCredentials.map((entry) => ({ ...entry, id: decodeBase64Url(entry.id) })) } as PublicKeyCredentialCreationOptions;
    const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
    if (!credential) throw new Error('Credential registration was cancelled.');
    const response = credential.response as AuthenticatorAttestationResponse;
    return { id: credential.id, rawId: encodeBase64Url(credential.rawId), type: credential.type,
        response: { clientDataJSON: encodeBase64Url(response.clientDataJSON),
            attestationObject: encodeBase64Url(response.attestationObject),
            transports: response.getTransports?.() ?? [] },
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: credential.authenticatorAttachment };
}

export async function confirmHumanPresence(options: PublicKeyOptions): Promise<Record<string, unknown>> {
    requireCredentialSupport();
    const allowCredentials = (options.allowCredentials as Array<{ id: string }> | undefined) ?? [];
    const publicKey = { ...options, challenge: decodeBase64Url(options.challenge as string),
        allowCredentials: allowCredentials.map((entry) => ({ ...entry, id: decodeBase64Url(entry.id) })) } as PublicKeyCredentialRequestOptions;
    const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
    if (!credential) throw new Error('Identity verification was cancelled.');
    const response = credential.response as AuthenticatorAssertionResponse;
    return { id: credential.id, rawId: encodeBase64Url(credential.rawId), type: credential.type,
        response: { clientDataJSON: encodeBase64Url(response.clientDataJSON),
            authenticatorData: encodeBase64Url(response.authenticatorData),
            signature: encodeBase64Url(response.signature),
            userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null },
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: credential.authenticatorAttachment };
}
