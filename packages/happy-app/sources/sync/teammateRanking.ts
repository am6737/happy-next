import type { Teammate } from 'happy-wire';

function matches(text: string, keyword: string): boolean {
    const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !!escaped && new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

export function rankTeammatesForIssue(teammates: Teammate[], issue: { repo: string; title: string; body?: string | null; labels?: string[] }): Array<{ teammate: Teammate; score: number; reasons: string[] }> {
    const text = [issue.title, issue.body ?? '', ...(issue.labels ?? [])].join('\n');
    return teammates.filter(teammate => teammate.status !== 'archived').map(teammate => {
        let score = 0;
        const reasons: string[] = [];
        if (teammate.repos.some(repo => repo.toLowerCase() === issue.repo.toLowerCase())) {
            score += 100;
            reasons.push('repo');
        }
        for (const skill of new Set(teammate.skills.map(skill => skill.trim().toLowerCase()))) {
            if (matches(text, skill)) { score += 10; reasons.push(`skill:${skill}`); }
        }
        if (teammate.role.split(/\s+/).some(word => word.length > 2 && matches(text, word))) {
            score += 3;
            reasons.push('role');
        }
        if (teammate.status === 'paused' || teammate.status === 'budget_paused') score -= 30;
        return { teammate, score, reasons };
    }).sort((a, b) => b.score - a.score || a.teammate.name.localeCompare(b.teammate.name));
}
