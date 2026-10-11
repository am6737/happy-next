import { describe, expect, it } from 'vitest';
import { renderAgentsMd, renderIdentityMd } from './templates';
import { makeTeammate } from './testFixtures';

describe('teammate skill templates', () => {
    it('renders installed notes and unavailable skills in identity and operating rules', () => {
        const teammate = makeTeammate({ skills: ['old-entry'] });
        const skills = { linked: ['review-pr'], missing: ['old-entry'] };
        const identity = renderIdentityMd(teammate, skills);
        expect(identity).toContain('review-pr (installed skill, use when relevant)');
        expect(identity).toContain('Unavailable skills (not installed on this machine): old-entry');
        expect(renderAgentsMd(teammate, skills)).toContain('Installed: review-pr');
        expect(renderAgentsMd(teammate, skills)).toContain('Unavailable (not installed on this machine): old-entry');
    });

    it('keeps legacy teammate skill rendering when no sync result is provided', () => {
        expect(renderIdentityMd(makeTeammate({ skills: ['TypeScript'] }))).toContain('- Skills: TypeScript');
    });
});
