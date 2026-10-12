import type { Prisma } from '@prisma/client';
import { TEAMMATE_HANDLE_REGEX } from 'happy-wire';
import { TeammateError } from './teammateError';

type Client = Pick<Prisma.TransactionClient, 'teammate'>;

/** Names are the user-facing identity: unique per account among non-archived Agents, ignoring case. */
export async function teammateNameAssertFree(tx: Client, accountId: string, name: string, exceptId?: string) {
    const clash = await tx.teammate.findFirst({
        where: { accountId, name: { equals: name.trim(), mode: 'insensitive' }, status: { not: 'archived' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: { id: true },
    });
    if (clash) throw new TeammateError('name_taken');
}

function slug(value: string): string {
    return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/, '');
}

/**
 * Picks the internal ASCII slug (git branches, commit email) from the hint or the name, falling back to
 * "agent" for names without ASCII letters, and suffixes "-2", "-3"… because archived Agents keep theirs.
 */
export async function teammateHandleAllocate(tx: Client, accountId: string, name: string, hint?: string): Promise<string> {
    const base = [hint ?? '', name].map(slug).find(candidate => TEAMMATE_HANDLE_REGEX.test(candidate)) ?? 'agent';
    const taken = new Set((await tx.teammate.findMany({ where: { accountId, handle: { startsWith: base } }, select: { handle: true } })).map(row => row.handle));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Resolves how an Agent refers to another one: its name, or a legacy handle from older instructions. */
export async function teammateFindByRef(tx: Client, accountId: string, ref: string) {
    const where = { accountId, status: 'active' };
    return await tx.teammate.findFirst({ where: { ...where, name: { equals: ref, mode: 'insensitive' } } })
        ?? await tx.teammate.findFirst({ where: { ...where, handle: ref.toLowerCase() } });
}
