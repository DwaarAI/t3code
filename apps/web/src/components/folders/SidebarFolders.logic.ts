import type { EnvironmentId, Folder } from "@t3tools/contracts";

interface FolderThreadPlacement {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly worktreePath: string | null;
}

/** Threads grouped by where they run: a member worktree, or a folder session's project. */
export function folderThreadGroupKey(thread: FolderThreadPlacement): string {
  return thread.worktreePath === null
    ? `${thread.environmentId}\u0000project:${thread.projectId}`
    : `${thread.environmentId}\u0000${thread.worktreePath}`;
}

/** Unarchived threads by `folderThreadGroupKey`, latest activity first. */
export function groupFolderThreads<
  T extends FolderThreadPlacement & {
    readonly archivedAt: string | null;
    readonly updatedAt: string;
  },
>(threads: ReadonlyArray<T>): ReadonlyMap<string, ReadonlyArray<T>> {
  const byWorktree = new Map<string, T[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const key = folderThreadGroupKey(thread);
    const list = byWorktree.get(key);
    if (list) list.push(thread);
    else byWorktree.set(key, [thread]);
  }
  for (const list of byWorktree.values()) {
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return byWorktree;
}

/**
 * Keys for every folder member worktree and folder session project, so thread
 * lists can leave folder threads to the Folders section. See `isFolderThreadKey`.
 */
export function folderThreadKeys(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly folders: ReadonlyArray<Folder>;
  }>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const { environmentId, folders } of environments) {
    for (const folder of folders) {
      for (const member of folder.members) {
        keys.add(folderThreadGroupKey({ environmentId, ...member }));
      }
      if (folder.rootProjectId) {
        keys.add(
          folderThreadGroupKey({
            environmentId,
            projectId: folder.rootProjectId,
            worktreePath: null,
          }),
        );
      }
    }
  }
  return keys;
}

export function isFolderThreadKey(
  keys: ReadonlySet<string>,
  thread: FolderThreadPlacement,
): boolean {
  return keys.has(folderThreadGroupKey(thread));
}
