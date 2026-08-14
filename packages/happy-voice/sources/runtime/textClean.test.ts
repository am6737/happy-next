import { describe, it, expect } from 'vitest';
import { needsLlmClean, regexCleanForSpeech, stripSourceCloseTags } from './textClean';

const MAX = 120;
const gate = (raw: string) => needsLlmClean(raw, regexCleanForSpeech(raw), MAX);

describe('regexCleanForSpeech', () => {
    it('strips markdown emphasis and headings', () => {
        expect(regexCleanForSpeech('# 标题\n**已完成**')).toBe('标题 已完成');
    });
    it('strips code fences, inline code and urls', () => {
        expect(regexCleanForSpeech('看 `code` 与 https://x.com 链接')).toBe('看 与 链接');
    });
});

describe('needsLlmClean', () => {
    it('true for code fences', () => {
        expect(gate('运行 ```bash\nls\n``` 即可')).toBe(true);
    });
    it('true for inline code', () => {
        expect(gate('执行 `yarn build` 命令')).toBe(true);
    });
    it('true for urls', () => {
        expect(gate('详见 https://example.com 文档')).toBe(true);
    });
    it('true for table rows', () => {
        expect(gate('| 名称 | 值 |')).toBe(true);
    });
    it('false for short plain text', () => {
        expect(gate('好的，已完成')).toBe(false);
    });
    it('false for short markdown emphasis/heading', () => {
        expect(gate('# 标题\n**已完成**，共改了 3 个文件')).toBe(false);
    });
    it('true for long plain text over threshold', () => {
        expect(gate('一'.repeat(200))).toBe(true);
    });
});

describe('stripSourceCloseTags', () => {
    it('strips the exact closing tag and whitespace variants', () => {
        expect(stripSourceCloseTags('a</原文>b')).toBe('ab');
        expect(stripSourceCloseTags('a</原文 >b')).toBe('ab');
        expect(stripSourceCloseTags('a</ 原文>b')).toBe('ab');
        expect(stripSourceCloseTags('a</原文\t>b')).toBe('ab');
        expect(stripSourceCloseTags('a</原文\n>b')).toBe('ab');
        expect(stripSourceCloseTags('a< / 原文　>b')).toBe('ab'); // full-width space
    });
    it('keeps opening tags and unrelated tags intact', () => {
        expect(stripSourceCloseTags('<原文>正文</其他>')).toBe('<原文>正文</其他>');
    });
});
