import { Webhooks } from "@octokit/webhooks";
import type { EmitterWebhookEvent } from "@octokit/webhooks";
import { log } from "@/utils/log";

let webhooks: Webhooks | null = null;

export async function initGithub() {
    webhooks = null;
    // Optional repository webhooks are independent of OAuth user authorization.
    if (process.env.GITHUB_WEBHOOK_SECRET) {
        webhooks = new Webhooks({
            secret: process.env.GITHUB_WEBHOOK_SECRET
        });
        
        // Register type-safe event handlers
        registerWebhookHandlers();
    }
}

function registerWebhookHandlers() {
    if (!webhooks) return;
    
    // Type-safe handlers for specific events
    webhooks.on("push", async ({ id, name, payload }: EmitterWebhookEvent<"push">) => {
        log({ module: 'github-webhook', event: 'push' }, 
            `Push to ${payload.repository.full_name} by ${payload.pusher.name}`);
    });
    
    webhooks.on("pull_request", async ({ id, name, payload }: EmitterWebhookEvent<"pull_request">) => {
        log({ module: 'github-webhook', event: 'pull_request' }, 
            `PR ${payload.action} on ${payload.repository.full_name}: #${payload.pull_request.number} - ${payload.pull_request.title}`);
    });
    
    webhooks.on("issues", async ({ id, name, payload }: EmitterWebhookEvent<"issues">) => {
        log({ module: 'github-webhook', event: 'issues' }, 
            `Issue ${payload.action} on ${payload.repository.full_name}: #${payload.issue.number} - ${payload.issue.title}`);
    });
    
    webhooks.on(["star.created", "star.deleted"], async ({ id, name, payload }: EmitterWebhookEvent<"star.created" | "star.deleted">) => {
        const action = payload.action === 'created' ? 'starred' : 'unstarred';
        log({ module: 'github-webhook', event: 'star' }, 
            `Repository ${action}: ${payload.repository.full_name} by ${payload.sender.login}`);
    });
    
    webhooks.on("repository", async ({ id, name, payload }: EmitterWebhookEvent<"repository">) => {
        log({ module: 'github-webhook', event: 'repository' }, 
            `Repository ${payload.action}: ${payload.repository.full_name}`);
    });
    
    // Catch-all for unhandled events
    webhooks.onAny(async ({ id, name, payload }: EmitterWebhookEvent) => {
        log({ module: 'github-webhook', event: name as string }, 
            `Received webhook event: ${name}`, { id });
    });
    
    webhooks.onError((error: any) => {
        log({ module: 'github-webhook', level: 'error' }, 
            `Webhook handler error: ${error.event?.name}`, error);
    });
}

export function getWebhooks(): Webhooks | null {
    return webhooks;
}
