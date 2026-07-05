import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { GitHubProfile } from "@/app/api/types";
import { getNameFromGitHubProfile } from "./githubName";

export async function backfillGitHubDisplayNames(): Promise<void> {
    const accounts = await db.account.findMany({
        where: {
            githubUserId: { not: null },
            OR: [
                { firstName: null },
                { firstName: '' }
            ]
        },
        select: {
            id: true,
            githubUser: {
                select: {
                    profile: true
                }
            }
        }
    });

    let updated = 0;
    for (const account of accounts) {
        const githubProfile = account.githubUser?.profile as GitHubProfile | null | undefined;
        if (!githubProfile?.login) {
            continue;
        }

        const name = getNameFromGitHubProfile(githubProfile);
        await db.account.update({
            where: { id: account.id },
            data: {
                firstName: name.firstName,
                lastName: name.lastName
            }
        });
        updated++;
    }

    if (updated > 0) {
        log({ module: 'github-display-name-backfill' }, `Backfilled display names for ${updated} GitHub-connected account(s)`);
    }
}
