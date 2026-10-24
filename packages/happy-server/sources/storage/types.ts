import { GitHubProfile as GitHubProfileType, GitHubOrg as GitHubOrgType } from "../app/api/types";
import { ImageRef as ImageRefType } from "./files";
declare global {
    namespace PrismaJson {
        // Session message content types
        type SessionMessageContent = {
            t: 'encrypted';
            c: string; // Base64 encoded encrypted content
        };

        // Usage report data structure
        type UsageReportData = {
            tokens: {
                total: number;
                [key: string]: number;
            };
            cost: {
                total: number;
                [key: string]: number;
            };
        };

        // Update content types
        type UpdateBody = {
            t: 'new-message';
            sid: string;
            message: {
                id: string;
                seq: number;
                content: SessionMessageContent;
                localId: string | null;
                createdAt: number;
                updatedAt: number;
            }
        } | {
            t: 'new-session';
            id: string;
            seq: number;
            metadata: string;
            metadataVersion: number;
            agentState: string | null;
            agentStateVersion: number;
            dataEncryptionKey: string | null;
            active: boolean;
            activeAt: number;
            createdAt: number;
            updatedAt: number;
        } | {
            t: 'update-session'
            id: string;
            metadata?: {
                value: string | null;
                version: number;
            } | null | undefined
            agentState?: {
                value: string | null;
                version: number;
            } | null | undefined
            capabilities?: {
                value: string;
                version: number;
            } | null | undefined
        } | {
            t: 'update-account';
            id: string;
            settings?: {
                value: string | null;
                version: number;
            } | null | undefined;
            github?: GitHubProfileType | null | undefined;
        } | {
            t: 'new-machine';
            machineId: string;
            seq: number;
            metadata: string;
            metadataVersion: number;
            daemonState: string | null;
            daemonStateVersion: number;
            dataEncryptionKey: string | null;
            active: boolean;
            activeAt: number;
            createdAt: number;
            updatedAt: number;
        } | {
            t: 'update-machine';
            machineId: string;
            metadata?: {
                value: string;
                version: number;
            };
            daemonState?: {
                value: string;
                version: number;
            };
            activeAt?: number;
        };

        type GitHubProfile = GitHubProfileType;
        type GitHubOrg = GitHubOrgType;
        type ImageRef = ImageRefType;

        // An OTA update's files and config; the manifest's urls are made from the hashes when served
        type OtaUpdateContent = {
            launchAsset: OtaUpdateAsset;
            assets: OtaUpdateAsset[];
            /// The app's public Expo config, the manifest's extra.expoClient
            expoClient: Record<string, unknown>;
        };
        type OtaUpdateAsset = {
            /// Base64url SHA-256, also the S3 key's last part
            hash: string;
            /// MD5 hex, the name the app stores the file under
            key: string;
            fileExtension: string;
            contentType: string;
        };
    }
}

// The file MUST be a module! 
export { };
