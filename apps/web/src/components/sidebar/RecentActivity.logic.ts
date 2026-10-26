import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { selectRecentActivity } from "@t3tools/client-runtime/recent-activity";
import { findFolderForThread } from "@t3tools/client-runtime/state/folders";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { RecentActivitySort } from "@t3tools/contracts/settings";

import type { EnvironmentFolders } from "../../state/folders";
import { formatRelativeTime } from "../../timestampFormat";
import { resolveThreadLastVisitedAt } from "../Sidebar.logic";

export const RECENT_ACTIVITY_SORT_OPTIONS = [
  { sort: "updated", label: "Updated" },
  { sort: "prompt", label: "Prompt" },
  { sort: "viewed", label: "Viewed" },
] as const satisfies ReadonlyArray<{ sort: RecentActivitySort; label: string }>;

export function isRecentActivitySort(value: unknown): value is RecentActivitySort {
  return RECENT_ACTIVITY_SORT_OPTIONS.some((option) => option.sort === value);
}

export interface RecentActivityTime {
  readonly sort: RecentActivitySort;
  readonly label: string;
  readonly value: string;
  readonly timestamp: string | null;
  readonly active: boolean;
}

export interface RecentActivityRow {
  readonly key: string;
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
  /** Folder name for folder threads, otherwise the project title. */
  readonly context: string | null;
  readonly times: ReadonlyArray<RecentActivityTime>;
}

export function compactRelativeTime(timestamp: string | null, nowMs: number): string {
  const relative = timestamp === null ? null : formatRelativeTime(timestamp, nowMs);
  if (relative === null) return "—";
  return relative.value === "just now" ? "now" : relative.value;
}

type RecentActivityThreadShell = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "projectId"
  | "title"
  | "worktreePath"
  | "updatedAt"
  | "latestUserMessageAt"
  | "lastVisitedAt"
  | "archivedAt"
  | "deletedAt"
>;

export function buildRecentActivityRows(input: {
  readonly threads: ReadonlyArray<RecentActivityThreadShell>;
  readonly localLastVisitedAtByKey: Readonly<Record<string, string>>;
  readonly projectTitleByKey: ReadonlyMap<string, string>;
  readonly folders: ReadonlyArray<EnvironmentFolders>;
  readonly sort: RecentActivitySort;
  readonly nowMs: number;
}): ReadonlyArray<RecentActivityRow> {
  const candidates = input.threads.map((thread) => {
    const threadRef = scopeThreadRef(thread.environmentId, thread.id);
    const key = scopedThreadKey(threadRef);
    return {
      thread,
      threadRef,
      key,
      updatedAt: thread.updatedAt,
      latestUserMessageAt: thread.latestUserMessageAt,
      archivedAt: thread.archivedAt,
      deletedAt: thread.deletedAt,
      // Same resolution as the sidebar, so servers without visited tracking
      // still fill the stack from this browser's own visits.
      lastVisitedAt:
        resolveThreadLastVisitedAt(thread.lastVisitedAt, input.localLastVisitedAtByKey[key]) ??
        null,
    };
  });
  return selectRecentActivity(candidates, input.sort).map((entry) => {
    const { thread } = entry;
    const environmentFolders = input.folders.find(
      (environment) => environment.environmentId === thread.environmentId,
    );
    const folder = environmentFolders
      ? findFolderForThread(environmentFolders.folders, thread)?.folder
      : undefined;
    const timestamps = {
      updated: entry.updatedAt,
      prompt: entry.latestUserMessageAt,
      viewed: entry.lastVisitedAt,
    } satisfies Record<RecentActivitySort, string | null>;
    return {
      key: entry.key,
      threadRef: entry.threadRef,
      title: thread.title,
      context:
        folder?.name ??
        input.projectTitleByKey.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ??
        null,
      times: RECENT_ACTIVITY_SORT_OPTIONS.map((option) => ({
        sort: option.sort,
        label: option.label,
        value: compactRelativeTime(timestamps[option.sort], input.nowMs),
        timestamp: timestamps[option.sort],
        active: option.sort === input.sort,
      })),
    };
  });
}
