import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createGithubIssue, updateGithubPull, deleteGithubIssueComment, uploadGithubImage } from './apiGithubData';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
const credentials = { token: 'happy', secret: 'secret' };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('__DEV__', false); });
afterEach(() => { vi.unstubAllGlobals(); });

test('writes remain on the Happy server using Happy authorization', async () => {
    fetchMock.mockImplementation(async () => new Response('{}'));
    await createGithubIssue(credentials, 'org', 'repo', { title: 'title' });
    await updateGithubPull(credentials, 'org', 'repo', 1, { state: 'closed' });
    await deleteGithubIssueComment(credentials, 'org', 'repo', 1);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
        ['https://happy.test/v1/github/repos/org/repo/issues', 'POST'],
        ['https://happy.test/v1/github/repos/org/repo/pulls/1', 'PATCH'],
        ['https://happy.test/v1/github/repos/org/repo/issues/comments/1', 'DELETE'],
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.headers as Record<string, string>).Authorization === 'Bearer happy')).toBe(true);
});

test('image uploads still use the original multipart server route', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Blob(['image'], { type: 'image/png' })));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { url: 'https://image.test', width: 1, height: 1 } })));
    expect(await uploadGithubImage(credentials, 'org', 'repo', 'blob:image', 'image/png')).toEqual({ url: 'https://image.test', width: 1, height: 1 });
    expect(fetchMock.mock.calls[1][0]).toBe('https://happy.test/v1/github/repos/org/repo/upload-image');
    expect(fetchMock.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer happy' });
});
