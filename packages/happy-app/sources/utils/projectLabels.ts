export type ProjectLabel = {
    /** The project's directory name — for a worktree, the repository's. */
    name: string;
    /** The worktree's name, for a path in a repository's `.dev/worktree/`. */
    worktree?: string;
    /**
     * The parent directory, only where other projects have the same name: as many of its last
     * directories as it takes to tell them apart (`…/wwwroot`), or all of it.
     */
    parent?: string;
};

const WORKTREE = /^(.*)\/\.dev\/worktree\/(.+)$/;

// Names for project paths: the directory name, with the parent directory added for the paths that
// share their name. Takes paths as displayed (`~/…`), keyed by them.
export function projectLabels(paths: readonly string[]): Map<string, ProjectLabel> {
    const parsed = Array.from(new Set(paths), path => {
        const worktree = path.match(WORKTREE);
        const project = worktree ? worktree[1] || '/' : path;
        const parts = project.split('/').filter(Boolean);
        const slash = project.lastIndexOf('/');
        return {
            path,
            project,
            label: { name: parts.at(-1) ?? project, worktree: worktree?.[2] } as ProjectLabel,
            // The home directory and the root have no parent.
            parent: parts.length > 1 || project.startsWith('/') && parts.length === 1
                ? project.slice(0, slash) || '/'
                : undefined,
        };
    });

    const clashes = new Map<string, typeof parsed>();
    for (const entry of parsed) {
        const key = `${entry.label.name}\0${entry.label.worktree ?? ''}`;
        clashes.set(key, [...(clashes.get(key) ?? []), entry]);
    }
    for (const clashing of clashes.values()) {
        if (new Set(clashing.map(entry => entry.project)).size < 2) continue;
        const parents = shortestDistinct(clashing.flatMap(entry => entry.parent ?? []));
        for (const entry of clashing) {
            if (entry.parent) entry.label.parent = parents.get(entry.parent);
        }
    }

    return new Map(parsed.map(entry => [entry.path, entry.label]));
}

// The last directories of each path, as many as tell it apart from the others: `…/b/c`, or the path
// whole once it takes all of them (or all but a `~`, which is no longer than the `…`).
function shortestDistinct(paths: readonly string[]): Map<string, string> {
    const unique = Array.from(new Set(paths));
    const segments = new Map(unique.map(path => [path, path.split('/').filter(Boolean)]));
    const depths = new Map(unique.map(path => [path, 1]));
    // Paths clash on the directories shown, however they're written: `~/wwwroot` and `…/wwwroot` do.
    const shown = (path: string) => segments.get(path)!.slice(-depths.get(path)!).join('/');
    const labelOf = (path: string) => {
        const parts = segments.get(path)!;
        const depth = depths.get(path)!;
        const whole = depth >= parts.length || depth === parts.length - 1 && parts[0] === '~';
        return whole ? path : `…/${shown(path)}`;
    };

    for (;;) {
        const byShown = new Map<string, string[]>();
        for (const path of unique) {
            byShown.set(shown(path), [...(byShown.get(shown(path)) ?? []), path]);
        }
        let deepened = false;
        for (const clashing of byShown.values()) {
            if (clashing.length < 2) continue;
            for (const path of clashing) {
                if (depths.get(path)! < segments.get(path)!.length) {
                    depths.set(path, depths.get(path)! + 1);
                    deepened = true;
                }
            }
        }
        if (!deepened) break;
    }

    return new Map(unique.map(path => [path, labelOf(path)]));
}
