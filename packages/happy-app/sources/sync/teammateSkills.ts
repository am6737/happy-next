import {
    TEAMMATE_RPC_LIST_SKILLS, TeammateListSkillsResponseSchema,
    type TeammateListSkillsRequest, type TeammateSkillInfo,
} from 'happy-wire';
import { apiSocket } from './apiSocket';

// The daemon scans a handful of directories; this should come back well within a few seconds.
const LIST_SKILLS_TIMEOUT_MS = 15_000;

export type TeammateSkillsResult =
    | { status: 'ready'; skills: TeammateSkillInfo[] }
    // The machine is unreachable, or its CLI predates the RPC. Callers fall back to a read-only view.
    | { status: 'unavailable' };

/** Asks the CLI on `machineId` which Skills are installed there (metadata only). Never throws. */
export async function listTeammateSkills(machineId: string): Promise<TeammateSkillsResult> {
    try {
        const raw = await apiSocket.machineRPC<unknown, TeammateListSkillsRequest>(machineId, TEAMMATE_RPC_LIST_SKILLS, {}, LIST_SKILLS_TIMEOUT_MS);
        const parsed = TeammateListSkillsResponseSchema.safeParse(raw);
        if (!parsed.success) return { status: 'unavailable' };
        return { status: 'ready', skills: parsed.data.skills };
    } catch {
        return { status: 'unavailable' };
    }
}
