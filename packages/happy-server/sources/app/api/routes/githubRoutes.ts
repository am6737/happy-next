import { z } from "zod";
import { type Fastify } from "../types";
import { getUserOctokit, GitHubNotConnectedError } from "@/app/github/githubApi";
import type { RequestError } from "octokit";
import { githubImageUpload } from "@/app/github/githubImageUpload";

const RepoIssueSchema = z.object({
    repositoryFullName: z.string().optional(),
    number: z.number(),
    title: z.string(),
    body: z.string(),
    state: z.enum(['open', 'closed']),
    author: z.string(),
    authorAvatarUrl: z.string(),
    createdAt: z.string(),
    labels: z.array(z.object({ name: z.string(), color: z.string() })),
    aiStatus: z.enum(['idle', 'running', 'completed', 'failed']),
    linkedPR: z.number().optional(),
    currentPhase: z.enum(['analyze', 'modify', 'pr']).optional(),
    progress: z.number().optional(),
});

const RepoIssueCommentSchema = z.object({
    id: z.number(),
    body: z.string(),
    author: z.string(),
    authorAvatarUrl: z.string(),
    authorAssociation: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

const RepoPRSchema = z.object({
    repositoryFullName: z.string().optional(),
    number: z.number(),
    title: z.string(),
    author: z.string(),
    authorAvatarUrl: z.string(),
    createdAt: z.string(),
    mergedAt: z.string().optional(),
    status: z.enum(['open', 'closed', 'merged']),
    headRefName: z.string().optional(),
    body: z.string().optional(),
});

const ErrorSchema = z.object({ error: z.string() });

const OwnerRepoParams = z.object({ owner: z.string(), repo: z.string() });
const OwnerRepoNumberParams = OwnerRepoParams.extend({ number: z.coerce.number().int() });

const githubErrorResponses = {
    401: ErrorSchema,
    403: ErrorSchema,
    404: ErrorSchema,
    422: ErrorSchema,
    429: ErrorSchema,
    500: ErrorSchema,
};

function repositoryFullNameFromApiUrl(repositoryUrl?: string): string | undefined {
    const marker = '/repos/';
    const markerIndex = repositoryUrl?.indexOf(marker) ?? -1;
    return markerIndex >= 0 ? repositoryUrl!.slice(markerIndex + marker.length) : undefined;
}

// ---------------------------------------------------------------------------
// Mappers — convert GitHub API responses to our schema
// ---------------------------------------------------------------------------

function mapIssue(i: any): z.infer<typeof RepoIssueSchema> {
    return {
        repositoryFullName: repositoryFullNameFromApiUrl(i.repository_url),
        number: i.number,
        title: i.title,
        body: i.body ?? '',
        state: i.state as 'open' | 'closed',
        author: i.user?.login ?? '',
        authorAvatarUrl: i.user?.avatar_url ?? '',
        createdAt: i.created_at,
        labels: (i.labels ?? []).map((l: any) => {
            if (typeof l === 'string') return { name: l, color: '' };
            return { name: l.name ?? '', color: l.color ?? '' };
        }),
        aiStatus: 'idle' as const,
    };
}

function mapPR(p: any): z.infer<typeof RepoPRSchema> {
    const mergedAt = p.merged_at ?? p.pull_request?.merged_at ?? undefined;
    return {
        repositoryFullName: repositoryFullNameFromApiUrl(p.repository_url),
        number: p.number,
        title: p.title,
        author: p.user?.login ?? '',
        authorAvatarUrl: p.user?.avatar_url ?? '',
        createdAt: p.created_at,
        mergedAt,
        status: mergedAt ? 'merged' as const : p.state as 'open' | 'closed',
        headRefName: p.head?.ref,
        body: p.body ?? undefined,
    };
}

function mapComment(c: any): z.infer<typeof RepoIssueCommentSchema> {
    return {
        id: c.id,
        body: c.body ?? '',
        author: c.user?.login ?? '',
        authorAvatarUrl: c.user?.avatar_url ?? '',
        authorAssociation: c.author_association ?? 'NONE',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleGitHubError(error: unknown, reply: any) {
    if (error instanceof GitHubNotConnectedError) {
        return reply.code(401).send({ error: 'github_not_connected' });
    }
    const status = (error as RequestError)?.status;
    const message = (error as any)?.message ?? String(error);
    console.error('[github-routes] error:', status, message, (error as any)?.response?.data ?? '');
    if (status === 401) {
        return reply.code(401).send({ error: 'github_token_expired' });
    }
    if (status === 403) {
        const headers = (error as RequestError).response?.headers;
        if (headers?.['x-ratelimit-remaining'] === '0' || headers?.['retry-after']) {
            return reply.code(429).send({ error: 'rate_limited' });
        }
        return reply.code(403).send({ error: 'GitHub access denied. Check repository permissions and organization OAuth App approval.' });
    }
    if (status === 404) {
        return reply.code(404).send({ error: 'not_found' });
    }
    if (status === 410) {
        return reply.code(422).send({ error: 'This feature has been disabled in this repository' });
    }
    if (status === 422) {
        return reply.code(422).send({ error: message });
    }
    if (status === 429) {
        return reply.code(429).send({ error: 'rate_limited' });
    }
    return reply.code(500).send({ error: message });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function githubRoutes(app: Fastify) {

    // Create issue
    app.post('/v1/github/repos/:owner/:repo/issues', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            body: z.object({
                title: z.string(),
                body: z.string().optional(),
                labels: z.array(z.string()).optional(),
            }),
            response: { 200: RepoIssueSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { title, body, labels } = request.body;

            const { data: i } = await octokit.rest.issues.create({
                owner,
                repo,
                title,
                body,
                labels,
            });

            return reply.send(mapIssue(i));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Update issue (close / reopen / edit)
    app.patch('/v1/github/repos/:owner/:repo/issues/:number', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            body: z.object({
                state: z.enum(['open', 'closed']).optional(),
                title: z.string().optional(),
                body: z.string().optional(),
                labels: z.array(z.string()).optional(),
            }),
            response: { 200: RepoIssueSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;

            const { data: i } = await octokit.rest.issues.update({
                owner,
                repo,
                issue_number: number,
                ...request.body,
            });

            return reply.send(mapIssue(i));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Update pull request (close / reopen)
    app.patch('/v1/github/repos/:owner/:repo/pulls/:number', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            body: z.object({
                state: z.enum(['open', 'closed']).optional(),
                title: z.string().optional(),
                body: z.string().optional(),
            }),
            response: { 200: RepoPRSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;

            const { data: p } = await octokit.rest.pulls.update({
                owner,
                repo,
                pull_number: number,
                ...request.body,
            });

            return reply.send(mapPR(p));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Create a comment on an issue or pull request
    app.post('/v1/github/repos/:owner/:repo/issues/:number/comments', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoNumberParams,
            body: z.object({ body: z.string().min(1) }),
            response: { 200: RepoIssueCommentSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, number } = request.params;
            const { body } = request.body;

            const { data: c } = await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: number,
                body,
            });

            return reply.send(mapComment(c));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Edit a comment on an issue or pull request
    app.patch('/v1/github/repos/:owner/:repo/issues/comments/:commentId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ owner: z.string(), repo: z.string(), commentId: z.coerce.number() }),
            body: z.object({ body: z.string().min(1) }),
            response: { 200: RepoIssueCommentSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, commentId } = request.params;
            const { body } = request.body;

            const { data } = await octokit.rest.issues.updateComment({
                owner,
                repo,
                comment_id: commentId,
                body,
            });

            return reply.send(mapComment(data));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Delete a comment on an issue or pull request
    app.delete('/v1/github/repos/:owner/:repo/issues/comments/:commentId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ owner: z.string(), repo: z.string(), commentId: z.coerce.number() }),
            response: { 200: z.object({ success: z.literal(true) }), ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo, commentId } = request.params;

            await octokit.rest.issues.deleteComment({
                owner,
                repo,
                comment_id: commentId,
            });

            return reply.send({ success: true as const });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Create pull request
    app.post('/v1/github/repos/:owner/:repo/pulls', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
            body: z.object({
                title: z.string(),
                body: z.string().optional(),
                head: z.string(),
                base: z.string(),
            }),
            response: { 200: RepoPRSchema, ...githubErrorResponses }
        }
    }, async (request, reply) => {
        try {
            const octokit = await getUserOctokit(request.userId);
            const { owner, repo } = request.params;
            const { title, body, head, base } = request.body;

            const { data: p } = await octokit.rest.pulls.create({
                owner,
                repo,
                title,
                body,
                head,
                base,
            });

            return reply.send(mapPR(p));
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });

    // Upload an image for use in GitHub issue/PR comments.
    // Uploads as a GitHub Release asset — returns a github.com download URL.
    app.post('/v1/github/repos/:owner/:repo/upload-image', {
        preHandler: app.authenticate,
        schema: {
            params: OwnerRepoParams,
        },
    }, async (request, reply) => {
        const { owner, repo } = request.params;

        let fileBuffer: Buffer | null = null;
        let fileMimeType: string | null = null;

        for await (const part of request.parts()) {
            if (part.type === 'file' && part.fieldname === 'file') {
                fileBuffer = await part.toBuffer();
                fileMimeType = part.mimetype;
            }
        }

        if (!fileBuffer) {
            return reply.status(400).send({ error: 'No file uploaded' });
        }

        // Validate magic bytes instead of trusting client-declared MIME type
        const isJPEG = fileBuffer[0] === 0xFF && fileBuffer[1] === 0xD8 && fileBuffer[2] === 0xFF;
        const isPNG = fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x4E && fileBuffer[3] === 0x47;
        if (!isJPEG && !isPNG) {
            return reply.status(400).send({ error: 'Only JPEG and PNG images are supported' });
        }
        const mimeType = isJPEG ? 'image/jpeg' : 'image/png';

        try {
            const octokit = await getUserOctokit(request.userId);
            const result = await githubImageUpload(octokit, owner, repo, fileBuffer, mimeType);
            return reply.send({ success: true, data: result });
        } catch (error) {
            return handleGitHubError(error, reply);
        }
    });
}
