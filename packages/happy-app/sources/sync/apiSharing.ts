import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import {
    SessionShare,
    SessionShareResponse,
    SessionSharesResponse,
    CreateSessionShareRequest,
    PublicSessionShare,
    PublicShareResponse,
    CreatePublicShareRequest,
    AccessPublicShareResponse,
    PublicShareNotFoundError,
    ConsentRequiredError,
    ShareNotFoundError,
    SessionSharingError
} from './sharingTypes';

export interface SharedSessionFromServer {
    sessionId: string;
    seq: number;
    metadata: string | null;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    active: boolean;
    activeAt: number;
    createdAt: number;
    updatedAt: number;
    accessLevel: 'view' | 'edit' | 'admin';
    encryptedDataKey: string;
    sharedBy: { id: string; firstName: string | null; lastName: string | null; username: string | null; avatar: string | null };
}

/**
 * Fetch all sessions shared with the current user
 */
export async function fetchSharedSessions(
    credentials: AuthCredentials
): Promise<SharedSessionFromServer[]> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/shared`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch shared sessions: ${response.status}`);
    }

    const data = await response.json();
    return data.sharedSessions;
}

export interface SharedByMeSession {
    sessionId: string;
    metadata: string | null;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    active: boolean;
    activeAt: number;
    createdAt: number;
    updatedAt: number;
    accessLevel: 'view' | 'edit' | 'admin';
}

/**
 * Fetch sessions the current user has shared with a specific user
 */
export async function fetchSessionsSharedByMe(
    credentials: AuthCredentials,
    withUserId: string
): Promise<SharedByMeSession[]> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/shared-by-me?withUserId=${encodeURIComponent(withUserId)}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch sessions shared by me: ${response.status}`);
    }

    const data = await response.json();
    return data.sessions;
}

/**
 * Upload content public key and binding signature to server
 */
export async function uploadContentPublicKey(
    credentials: AuthCredentials,
    contentPublicKey: string,
    contentPublicKeySig: string
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/user/content-key`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ contentPublicKey, contentPublicKeySig })
    });

    if (!response.ok) {
        throw new Error(`Failed to upload content public key: ${response.status}`);
    }
}

/**
 * Get all shares for a session
 */
export async function getSessionShares(
    credentials: AuthCredentials,
    sessionId: string
): Promise<SessionShare[]> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/shares`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
        }
    });

    if (!response.ok) {
        if (response.status === 403) {
            throw new SessionSharingError('Forbidden');
        }
        throw new Error(`Failed to get session shares: ${response.status}`);
    }

    const data: SessionSharesResponse = await response.json();
    return data.shares;
}

/**
 * Share a session with a specific user
 */
export async function createSessionShare(
    credentials: AuthCredentials,
    sessionId: string,
    request: CreateSessionShareRequest
): Promise<SessionShare> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/shares`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
    });

    if (!response.ok) {
        if (response.status === 403) {
            const error = await response.json();
            throw new SessionSharingError(error.error || 'Forbidden');
        }
        if (response.status === 400) {
            const error = await response.json();
            throw new SessionSharingError(error.error || 'Bad request');
        }
        throw new Error(`Failed to create session share: ${response.status}`);
    }

    const data: SessionShareResponse = await response.json();
    return data.share;
}

/**
 * Update the access level of an existing share
 */
export async function updateSessionShare(
    credentials: AuthCredentials,
    sessionId: string,
    shareId: string,
    accessLevel: 'view' | 'edit' | 'admin'
): Promise<SessionShare> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/shares/${shareId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ accessLevel })
    });

    if (!response.ok) {
        if (response.status === 403) {
            throw new SessionSharingError('Forbidden');
        }
        if (response.status === 404) {
            throw new ShareNotFoundError();
        }
        throw new Error(`Failed to update session share: ${response.status}`);
    }

    const data: SessionShareResponse = await response.json();
    return data.share;
}

/**
 * Delete a share and revoke user access
 */
export async function deleteSessionShare(
    credentials: AuthCredentials,
    sessionId: string,
    shareId: string
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/shares/${shareId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
        }
    });

    if (!response.ok) {
        if (response.status === 403) {
            throw new SessionSharingError('Forbidden');
        }
        if (response.status === 404) {
            throw new ShareNotFoundError();
        }
        throw new Error(`Failed to delete session share: ${response.status}`);
    }
}

/**
 * Leave a session shared with the current user
 */
export async function leaveSharedSession(
    credentials: AuthCredentials,
    sessionId: string
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/share-self`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
        }
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new ShareNotFoundError();
        }
        throw new Error(`Failed to leave shared session: ${response.status}`);
    }
}

/**
 * Get public share info for a session
 */
export async function getPublicShare(
    credentials: AuthCredentials,
    sessionId: string
): Promise<PublicSessionShare | null> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/public-share`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
        }
    });

    if (!response.ok) {
        if (response.status === 404) {
            return null;
        }
        if (response.status === 403) {
            throw new SessionSharingError('Forbidden');
        }
        throw new Error(`Failed to get public share: ${response.status}`);
    }

    const data: PublicShareResponse = await response.json();
    return data.publicShare;
}

/**
 * Create or update a public share link for a session
 */
export async function createPublicShare(
    credentials: AuthCredentials,
    sessionId: string,
    request: CreatePublicShareRequest & { token: string }
): Promise<PublicSessionShare> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/public-share`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
    });

    if (!response.ok) {
        if (response.status === 403) {
            throw new SessionSharingError('Forbidden');
        }
        throw new Error(`Failed to create public share: ${response.status}`);
    }

    const data: PublicShareResponse = await response.json();
    return data.publicShare;
}

/**
 * Delete public share (disable public link)
 */
export async function deletePublicShare(
    credentials: AuthCredentials,
    sessionId: string
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/sessions/${sessionId}/public-share`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
        }
    });

    if (!response.ok) {
        if (response.status === 403) {
            throw new SessionSharingError('Forbidden');
        }
        throw new Error(`Failed to delete public share: ${response.status}`);
    }
}

export interface PublicShareMessage {
    id: string;
    seq: number;
    content: { t: string; c: string };
    localId: string | null;
    createdAt: number;
    updatedAt: number;
}

/**
 * Fetch a page of messages from a public share (public endpoint, no auth required).
 *
 * Pagination mirrors the authenticated v3 messages route: messages come back newest-first,
 * `beforeSeq` loads the page of older messages preceding that seq, and `hasMore` indicates
 * whether older messages still exist.
 */
export async function getPublicShareMessages(
    serverUrl: string,
    token: string,
    opts?: { consent?: boolean; beforeSeq?: number; limit?: number; resourceAccessToken?: string }
): Promise<{ messages: PublicShareMessage[]; hasMore: boolean }> {
    const url = new URL(`${serverUrl}/v1/public-share/${token}/messages`);
    if (opts?.consent) {
        url.searchParams.set('consent', 'true');
    }
    if (opts?.beforeSeq !== undefined) {
        url.searchParams.set('before_seq', String(opts.beforeSeq));
    }
    if (opts?.limit !== undefined) {
        url.searchParams.set('limit', String(opts.limit));
    }

    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: opts?.resourceAccessToken
            ? { 'X-Public-Share-Access': opts.resourceAccessToken }
            : undefined,
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new PublicShareNotFoundError();
        }
        if (response.status === 403) {
            const body = await response.json();
            if (body.requiresConsent) {
                throw new ConsentRequiredError(body.owner);
            }
        }
        throw new Error(`Failed to get public share messages: ${response.status}`);
    }

    const data = await response.json();
    return { messages: data.messages as PublicShareMessage[], hasMore: data.hasMore ?? false };
}

export async function renewPublicShareAccess(
    serverUrl: string,
    token: string,
    resourceAccessToken: string,
): Promise<string> {
    const response = await fetch(`${serverUrl}/v1/public-share/${token}/access-token`, {
        method: 'POST',
        headers: { 'X-Public-Share-Access': resourceAccessToken },
    });
    if (!response.ok) {
        throw new PublicShareNotFoundError();
    }
    const data = await response.json() as { resourceAccessToken: string };
    return data.resourceAccessToken;
}

/**
 * Access a session via a public share token (public endpoint, no auth required)
 */
export async function accessPublicShare(
    serverUrl: string,
    token: string,
    consent?: boolean
): Promise<AccessPublicShareResponse> {
    const url = new URL(`${serverUrl}/v1/public-share/${token}`);
    if (consent) {
        url.searchParams.set('consent', 'true');
    }

    const response = await fetch(url.toString(), {
        method: 'GET',
    });

    if (!response.ok) {
        if (response.status === 404) {
            throw new PublicShareNotFoundError();
        }
        if (response.status === 403) {
            const body = await response.json();
            if (body.requiresConsent) {
                throw new ConsentRequiredError(body.owner);
            }
        }
        throw new Error(`Failed to access public share: ${response.status}`);
    }

    return await response.json();
}
