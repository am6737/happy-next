import { useState, useCallback, useEffect, useRef } from 'react';
import { accessPublicShare, getPublicShareMessages, PublicShareMessage } from '@/sync/apiSharing';
import { decryptDataKeyFromPublicShare } from '@/sync/encryption/publicShareEncryption';
import { AES256Encryption } from '@/sync/encryption/encryptor';
import { decodeBase64 } from '@/encryption/base64';
import { normalizeRawMessage, NormalizedMessage } from '@/sync/typesRaw';
import { createReducer, reducer } from '@/sync/reducer/reducer';
import { getServerUrl } from '@/sync/serverConfig';
import { PublicShareNotFoundError, ConsentRequiredError, ShareUserProfile } from '@/sync/sharingTypes';
import { Message } from '@/sync/typesMessage';
import { Metadata, MetadataSchema } from '@/sync/storageTypes';

export type PublicShareState = 'loading' | 'loaded' | 'error' | 'consent-required' | 'not-found';

// Page size for the public share viewer. The server returns the newest page first, then we
// page backwards through older messages with `before_seq` as the user scrolls up.
const PAGE_SIZE = 100;

/**
 * Read-only public share session viewer with cursor pagination.
 *
 * Unlike normal sessions (which run through the full Sync engine: sockets, storage, incremental
 * sync, persisted cursors, auth), a public share is anonymous and read-only, so this hook keeps
 * its own lightweight pagination state:
 *  - `decryptorRef` holds the AES key derived from the share token so `loadMore` can decrypt
 *    additional pages without re-deriving it.
 *  - `rawMessagesRef` accumulates every decrypted+normalized message (oldest-first). Each page is
 *    prepended, then the reducer is re-run over the whole set — re-reducing is required because
 *    tool calls / sidechains can span page boundaries, and it keeps the merge logic identical to
 *    the single-shot path.
 *  - `oldestSeqRef` is the cursor for the next older page; `hasMore` reports whether one exists.
 */
export function usePublicShareSession(token: string) {
    const [state, setState] = useState<PublicShareState>('loading');
    const [messages, setMessages] = useState<Message[]>([]);
    const [metadata, setMetadata] = useState<Metadata | null>(null);
    const [owner, setOwner] = useState<ShareUserProfile | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const consentRef = useRef(false);
    const decryptorRef = useRef<AES256Encryption | null>(null);
    const rawMessagesRef = useRef<NormalizedMessage[]>([]);
    const oldestSeqRef = useRef<number | null>(null);
    const loadingMoreRef = useRef(false);

    // Decrypt a page of encrypted messages (server returns newest-first) into normalized messages
    // ordered oldest-first, and report the smallest seq in the page (the next pagination cursor).
    const processPage = useCallback(async (
        decryptor: AES256Encryption,
        encryptedMessages: PublicShareMessage[],
    ): Promise<{ normalized: NormalizedMessage[]; minSeq: number | null }> => {
        if (encryptedMessages.length === 0) {
            return { normalized: [], minSeq: null };
        }
        // Reverse to oldest-first so the reducer processes messages chronologically.
        const reversed = [...encryptedMessages].reverse();
        const encryptedBytes = reversed.map(m => decodeBase64(m.content.c, 'base64'));
        const decryptedContents = await decryptor.decrypt(encryptedBytes);
        const normalized = reversed
            .map((m, i) => {
                const content = decryptedContents[i];
                if (!content) return null;
                return normalizeRawMessage(m.id, m.localId, m.createdAt, content);
            })
            .filter((m): m is NonNullable<typeof m> => m !== null);
        const minSeq = Math.min(...encryptedMessages.map(m => m.seq));
        return { normalized, minSeq };
    }, []);

    // Re-run the reducer over all accumulated normalized messages and publish them newest-first.
    const publishMessages = useCallback(() => {
        const result = reducer(createReducer(), rawMessagesRef.current);
        // Sort by createdAt since the reducer processes event messages (e.g. title changes) before
        // regular messages, breaking chronological order.
        result.messages.sort((a, b) => b.createdAt - a.createdAt);
        setMessages(result.messages);
    }, []);

    const load = useCallback(async (withConsent: boolean) => {
        try {
            setState('loading');
            // Reset pagination accumulators on every (re)load.
            rawMessagesRef.current = [];
            oldestSeqRef.current = null;
            setHasMore(false);

            const serverUrl = getServerUrl();
            const consent = withConsent || undefined;

            // 1. Access public share to get session info + encrypted data key
            const shareData = await accessPublicShare(serverUrl, token, consent);
            setOwner(shareData.owner);
            setSessionId(shareData.session.id);

            // 2. Decrypt data key from token
            const dataKey = await decryptDataKeyFromPublicShare(shareData.encryptedDataKey, token);
            if (!dataKey) {
                setState('error');
                return;
            }

            const decryptor = new AES256Encryption(dataKey);
            decryptorRef.current = decryptor;

            // 3. Decrypt metadata
            if (shareData.session.metadata) {
                try {
                    const metadataBytes = decodeBase64(shareData.session.metadata, 'base64');
                    const [decryptedMetadata] = await decryptor.decrypt([metadataBytes]);
                    if (decryptedMetadata) {
                        const parsed = MetadataSchema.safeParse(decryptedMetadata);
                        if (parsed.success) {
                            setMetadata(parsed.data);
                        }
                    }
                } catch {
                    // Metadata decryption is non-critical
                }
            }

            // 4. Fetch the newest page of encrypted messages
            const { messages: encryptedMessages, hasMore: more } = await getPublicShareMessages(serverUrl, token, {
                consent,
                limit: PAGE_SIZE,
            });

            // 5. Decrypt + normalize + reduce
            const { normalized, minSeq } = await processPage(decryptor, encryptedMessages);
            rawMessagesRef.current = normalized;
            oldestSeqRef.current = minSeq;
            setHasMore(more);
            publishMessages();
            setState('loaded');
        } catch (e) {
            if (e instanceof PublicShareNotFoundError) {
                setState('not-found');
            } else if (e instanceof ConsentRequiredError) {
                setOwner(e.owner);
                setState('consent-required');
            } else {
                setState('error');
            }
        }
    }, [token, processPage, publishMessages]);

    // Load the next older page. Triggered when the inverted list reaches its end (scrolled to top).
    const loadMore = useCallback(async () => {
        if (loadingMoreRef.current) return;
        const decryptor = decryptorRef.current;
        const before = oldestSeqRef.current;
        if (!decryptor || before === null) return;

        loadingMoreRef.current = true;
        setIsLoadingMore(true);
        try {
            const serverUrl = getServerUrl();
            const consent = consentRef.current || undefined;
            const { messages: encryptedMessages, hasMore: more } = await getPublicShareMessages(serverUrl, token, {
                consent,
                beforeSeq: before,
                limit: PAGE_SIZE,
            });

            const { normalized, minSeq } = await processPage(decryptor, encryptedMessages);
            if (normalized.length > 0) {
                // Older messages go in front of the accumulator (which is oldest-first).
                rawMessagesRef.current = [...normalized, ...rawMessagesRef.current];
            }
            if (minSeq !== null) {
                oldestSeqRef.current = minSeq;
            }
            setHasMore(more);
            publishMessages();
        } catch {
            // Never surface loading errors — the user can retry by scrolling again.
        } finally {
            loadingMoreRef.current = false;
            setIsLoadingMore(false);
        }
    }, [token, processPage, publishMessages]);

    useEffect(() => {
        load(false);
    }, [load]);

    const giveConsent = useCallback(() => {
        if (!consentRef.current) {
            consentRef.current = true;
            load(true);
        }
    }, [load]);

    return { state, messages, metadata, owner, sessionId, hasMore, isLoadingMore, loadMore, giveConsent };
}
