import Fuse from 'fuse.js';
import { getSession, storage } from './storage';

export type SkillScope = 'REPO' | 'USER' | 'ADMIN' | 'SYSTEM';

export interface SkillItem {
    name: string;
    description: string;
    scope: SkillScope;
    path: string;
    displayName?: string;
    shortDescription?: string;
}

/**
 * Codex presents skills in installation scope order. Keep the wire scopes
 * (`REPO`, `USER`, `ADMIN`, `SYSTEM`) intact, but normalize their ordering so
 * project skills are followed by personal skills and then global skills.
 */
const SKILL_SCOPE_ORDER: Record<SkillScope, number> = {
    REPO: 0,
    USER: 1,
    ADMIN: 2,
    SYSTEM: 2,
};

export function sortSkillsByScope(skills: SkillItem[]): SkillItem[] {
    return skills
        .map((skill, index) => ({ skill, index }))
        .sort((a, b) => {
            const scopeOrder = SKILL_SCOPE_ORDER[a.skill.scope] - SKILL_SCOPE_ORDER[b.skill.scope];
            if (scopeOrder !== 0) return scopeOrder;

            // Preserve discovery/search order within a scope. This keeps Fuse's
            // relevance ordering while making the three scope groups contiguous.
            return a.index - b.index;
        })
        .map(({ skill }) => skill);
}

interface SearchOptions {
    limit?: number;
    threshold?: number;
}

function getSkillsFromSession(sessionId: string): SkillItem[] {
    const capabilities = storage.getState().sessionCapabilities[sessionId]?.capabilities;
    if (capabilities?.skills) {
        return capabilities.skills;
    }

    const session = getSession(sessionId);
    if (!session?.metadata?.skills) {
        return [];
    }

    return session.metadata.skills;
}

export function searchSkills(
    sessionId: string,
    query: string,
    options: SearchOptions = {}
): SkillItem[] {
    const { limit, threshold = 0.35 } = options;
    const skills = getSkillsFromSession(sessionId);

    if (!query || query.trim().length === 0) {
        return limit ? skills.slice(0, limit) : skills;
    }

    const fuse = new Fuse(skills, {
        keys: [
            { name: 'name', weight: 0.45 },
            { name: 'displayName', weight: 0.25 },
            { name: 'description', weight: 0.2 },
            { name: 'shortDescription', weight: 0.1 },
        ],
        threshold,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 1,
        ignoreLocation: true,
    });

    return fuse.search(query, limit ? { limit } : undefined).map(result => result.item);
}
