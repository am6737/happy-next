import { PrismaClient } from "@prisma/client";

function pooledDatabaseUrl(): string | undefined {
    const configured = process.env.DATABASE_URL;
    if (!configured) return undefined;
    const url = new URL(configured);
    const configuredMax = Number(process.env.AI_DB_POOL_MAX || 10);
    const max = Number.isSafeInteger(configuredMax) && configuredMax > 0
        ? Math.min(configuredMax, 50) : 10;
    if (!url.searchParams.has('connection_limit')) {
        url.searchParams.set('connection_limit', String(max));
    }
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '5');
    return url.toString();
}

const databaseUrl = pooledDatabaseUrl();
export const db = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : new PrismaClient();
