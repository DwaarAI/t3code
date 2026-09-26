import { findFolderForThread } from "@t3tools/client-runtime/state/folders";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, Folder } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import type { EnvironmentFolders } from "../../state/folders";

export interface FolderListEntry {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly folder: Folder;
  readonly threadCount: number;
  /** Latest thread update in the folder, or its creation when it has none. */
  readonly lastActivityAt: string;
}

export interface FolderThreadEntry {
  readonly thread: EnvironmentThreadShell;
  /** The repository the thread works in; null for a folder session spanning all of them. */
  readonly repoName: string | null;
}

const timestamp = (iso: string) => {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

const byRecentThread = Order.mapInput(Order.flip(Order.Number), (entry: FolderThreadEntry) =>
  timestamp(entry.thread.updatedAt),
);

/** Live threads of one folder, newest first. */
export function buildFolderThreads(input: {
  readonly environmentId: EnvironmentId;
  readonly folder: Folder;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}): ReadonlyArray<FolderThreadEntry> {
  const entries: FolderThreadEntry[] = [];
  for (const thread of input.threads) {
    if (thread.environmentId !== input.environmentId || thread.archivedAt !== null) continue;
    const match = findFolderForThread([input.folder], thread);
    if (match) entries.push({ thread, repoName: match.member?.repoName ?? null });
  }
  return Arr.sort(entries, byRecentThread);
}

/** Active folders across environments, most recently worked on first. */
export function buildFolderList(input: {
  readonly environments: ReadonlyArray<EnvironmentFolders>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly searchQuery: string;
}): ReadonlyArray<FolderListEntry> {
  const query = input.searchQuery.trim().toLocaleLowerCase();
  const entries: FolderListEntry[] = [];
  for (const { environmentId, folders } of input.environments) {
    for (const folder of folders) {
      if (folder.archivedAt !== null) continue;
      if (query.length > 0 && !matchesQuery(folder, query)) continue;
      const threads = buildFolderThreads({ environmentId, folder, threads: input.threads });
      entries.push({
        key: `${environmentId}:${folder.slug}`,
        environmentId,
        folder,
        threadCount: threads.length,
        lastActivityAt: threads[0]?.thread.updatedAt ?? folder.createdAt,
      });
    }
  }
  return Arr.sort(
    entries,
    Order.mapInput(
      Order.Struct({ activity: Order.flip(Order.Number), name: Order.String }),
      (entry: FolderListEntry) => ({
        activity: timestamp(entry.lastActivityAt),
        name: entry.folder.name.toLocaleLowerCase(),
      }),
    ),
  );
}

function matchesQuery(folder: Folder, query: string): boolean {
  return (
    folder.name.toLocaleLowerCase().includes(query) ||
    folder.slug.includes(query) ||
    (folder.issue?.title.toLocaleLowerCase().includes(query) ?? false) ||
    folder.members.some((member) => member.repoName.toLocaleLowerCase().includes(query))
  );
}
