import type { StoredChannelMessage } from '@/sync/channelReducers';

export interface ChannelRowLayout {
    /** The date pill shown above the row when it starts a new local day. */
    date: string | null;
    /** Avatar, name and time: only the first row of a sender's run shows them. */
    header: boolean;
    /** Same sender as the row above, so it sits closer to it. */
    continued: boolean;
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function localDay(time: number): string {
    const date = new Date(time);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** HH:mm, as the DooTask chat shows it. */
export function channelTime(time: number): string {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Messages further apart than this start a new run, so each one shows its own time. */
const RUN_GAP_MS = 5 * 60_000;

/**
 * Mirrors the DooTask chat list: a date pill per day (MM-DD this year, YYYY-MM-DD before), and a
 * header only where a sender's run starts. System notices and gaps over five minutes break runs.
 */
export function channelRowLayouts(messages: StoredChannelMessage[], now = Date.now()): ChannelRowLayout[] {
    const year = `${new Date(now).getFullYear()}-`;
    return messages.map((message, index) => {
        const previous = index > 0 ? messages[index - 1] : null;
        const day = localDay(message.createdAt);
        const date = !previous || localDay(previous.createdAt) !== day ? (day.startsWith(year) ? day.slice(5) : day) : null;
        const system = message.content.t === 'system';
        const continued = !!previous && !date && !system && previous.content.t !== 'system'
            && previous.senderType === message.senderType && previous.senderId === message.senderId
            && message.createdAt - previous.createdAt <= RUN_GAP_MS;
        return { date, header: !system && !continued, continued };
    });
}

const GITHUB_REFERENCE = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/(?:pull|issues)\/(\d+)/i;
const URL_HOST = /^[a-z][a-z\d+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i;

/** The repository and number a GitHub PR or issue link points to. */
export function channelGithubReference(link: { kind: string; url?: string }): { owner: string; repo: string; number: number } | null {
    const match = (link.kind === 'pr' || link.kind === 'issue') ? link.url?.match(GITHUB_REFERENCE) : null;
    return match ? { owner: match[1], repo: match[2], number: Number(match[3]) } : null;
}

/** What a link card names besides its kind: GitHub PRs and issues their repository and number, other links their host. */
export function channelLinkSource(link: { kind: string; url?: string }): { source: string | null; number: string | null } {
    if (!link.url || link.kind === 'session') return { source: null, number: null };
    const github = channelGithubReference(link);
    if (github) return { source: `${github.owner}/${github.repo}`, number: `#${github.number}` };
    return { source: link.url.match(URL_HOST)?.[1] ?? null, number: null };
}

export type GithubLinkState = 'open' | 'draft' | 'merged' | 'closed' | 'notPlanned';

/** The state GitHub colors a PR or issue by. Issues closed as not planned or as duplicates are gray there, not purple. */
export function githubLinkState(item: { status: 'open' | 'closed' | 'merged'; isDraft?: boolean } | { state: 'open' | 'closed'; stateReason?: string } | null): GithubLinkState | null {
    if (!item) return null;
    if ('status' in item) return item.status === 'open' && item.isDraft ? 'draft' : item.status;
    return item.state === 'closed' && (item.stateReason === 'not_planned' || item.stateReason === 'duplicate') ? 'notPlanned' : item.state;
}
