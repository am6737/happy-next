import { GitHubProfile } from "@/app/api/types";
import { separateName } from "@/utils/separateName";

export function getNameFromGitHubProfile(githubProfile: Pick<GitHubProfile, 'name' | 'login'>): {
    firstName: string;
    lastName: string | null;
} {
    const parsedName = separateName(githubProfile.name);
    return {
        firstName: parsedName.firstName || githubProfile.login,
        lastName: parsedName.firstName ? parsedName.lastName : null
    };
}
