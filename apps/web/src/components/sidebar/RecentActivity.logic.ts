import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";
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
  {
    sort: "updated",
    label: msg("Updated", { $context: "recent activity sort, last update time" }),
  },
  { sort: "prompt", label: msg("Prompt", { $context: "recent activity sort, last prompt time" }) },
  { sort: "viewed", label: msg("Viewed", { $context: "recent activity sort, last viewed time" }) },
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

export function compactRelativeTime(
  timestamp: string | null,
  nowMs: number,
  resolve: MessageResolver = m,
): string {
  const relative = timestamp === null ? null : formatRelativeTime(timestamp, nowMs, resolve);
  if (relative === null) return "–";
  // Under a minute there is no "ago" suffix and the value reads "just now".
  return relative.suffix === null
    ? resolve(msg("now", { $context: "compact relative time, under a minute ago" }))
    : relative.value;
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
  readonly resolve?: MessageResolver;
}): ReadonlyArray<RecentActivityRow> {
  const resolve = input.resolve ?? m;
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
        label: resolve(option.label),
        value: compactRelativeTime(timestamps[option.sort], input.nowMs, resolve),
        timestamp: timestamps[option.sort],
        active: option.sort === input.sort,
      })),
    };
  });
}
