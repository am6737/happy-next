import { describe, expect, it } from 'vitest';
import { findMentions, mentionIds } from './teammateMention';

const members = [
  { id: 'ming', name: '小明' },
  { id: 'ming2', name: '小明二号' },
  { id: 'cr', name: 'Code Reviewer', handle: 'reviewer' },
  { id: 'nova', name: 'Nova', handle: 'nova' },
];

describe('findMentions', () => {
  it('prefers the longest name and needs no space after CJK names', () => {
    expect(mentionIds('@小明二号看下，@小明帮我', members)).toEqual(['ming2', 'ming']);
  });

  it('matches names with spaces, case-insensitively, also right after CJK text', () => {
    expect(mentionIds('请@code reviewer 看看', members)).toEqual(['cr']);
  });

  it('ignores emails, partial ASCII words and unknown names', () => {
    expect(mentionIds('mail me@nova.dev, @Novak, @nova-x, @someone', members)).toEqual([]);
  });

  it('still resolves legacy handles', () => {
    expect(mentionIds('@reviewer and @nova, please', members)).toEqual(['cr', 'nova']);
  });

  it('returns the matched ranges', () => {
    expect(findMentions('hi @Nova!', members)).toEqual([{ id: 'nova', start: 3, end: 8 }]);
  });
});
