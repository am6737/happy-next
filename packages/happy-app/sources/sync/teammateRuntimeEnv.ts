import { TeammateRuntimeEnvSchema, type TeammateWorkerProvider } from 'happy-wire';
import { encodeBase64 } from '@/encryption/base64';
import { getSessionProfileEnvironment, shouldInheritMachineConfig } from '@/utils/sessionProfile';
import { AES256Encryption } from './encryption/encryptor';
import { getBuiltInProfile } from './profileUtils';
import { storage } from './storage';
import { sync } from './sync';

/**
 * Seal a profile's environment for an Agent runtime role, the same way a new session passes it to the daemon.
 * Profiles live only in app settings and may hold secrets, so the blob is encrypted with the bound machine's key;
 * re-seal it whenever the machine, profile or provider changes. Null means the machine's own configuration.
 */
export async function encryptTeammateProfileEnv(machineId: string, profileId: string | null, agent: TeammateWorkerProvider): Promise<string | null> {
    if (!profileId) return null;
    const profile = storage.getState().settings.profiles.find(item => item.id === profileId) ?? getBuiltInProfile(profileId);
    if (!profile) return null;
    const environmentVariables = getSessionProfileEnvironment(profile, agent);
    const env = TeammateRuntimeEnvSchema.parse({ environmentVariables, inheritMachineConfig: shouldInheritMachineConfig(environmentVariables) });
    const [encrypted] = await new AES256Encryption(await sync.channels.getMachineKey(machineId)).encrypt([env]);
    return encodeBase64(encrypted);
}
