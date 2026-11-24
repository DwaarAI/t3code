import { selectRecentActivity } from "@t3tools/client-runtime/recent-activity";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { RecentActivitySort } from "@t3tools/contracts/settings";
import { msg } from "gt-react-native";

import type { SegmentedControlProps } from "../../components/ui/SegmentedControl.types";
import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import { m, type MessageResolver } from "../../i18n/messages";
import { relativeTime } from "../../lib/time";

const SORT_LABELS = {
  updated: msg("Updated", { $context: "recent activity sort, last updated time" }),
  prompt: msg("Prompt", { $context: "recent activity sort, last prompt time" }),
  viewed: msg("Viewed", { $context: "recent activity sort, last viewed time" }),
};

export function recentActivitySortOptions(
  resolve: MessageResolver = m,
): SegmentedControlProps<RecentActivitySort>["options"] {
  return [
    {
      value: "updated",
      label: resolve(SORT_LABELS.updated),
      accessibilityLabel: resolve(msg("Sort by last updated")),
    },
    {
      value: "prompt",
      label: resolve(SORT_LABELS.prompt),
      accessibilityLabel: resolve(msg("Sort by last prompt")),
    },
    {
      value: "viewed",
      label: resolve(SORT_LABELS.viewed),
      accessibilityLabel: resolve(msg("Sort by last viewed")),
    },
  ];
}

export interface RecentActivityTime {
  readonly sort: RecentActivitySort;
  readonly label: string;
  /** Relative age such as "5m", or "-" when the thread has no such time. */
  readonly age: string;
}

export interface RecentActivityRow {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly projectTitle: string | null;
  /** Always Updated, Prompt, Viewed, so the columns stay put when the sort changes. */
  readonly times: readonly [RecentActivityTime, RecentActivityTime, RecentActivityTime];
}

const age = (iso: string | null | undefined, nowMs: number, resolve: MessageResolver) =>
  iso ? relativeTime(iso, nowMs, resolve) : "-";

export function buildRecentActivityRows(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly sort: RecentActivitySort;
  readonly nowMs: number;
  readonly resolve?: MessageResolver;
}): ReadonlyArray<RecentActivityRow> {
  const resolve = input.resolve ?? m;
  const projectTitleByKey = new Map(
    input.projects.map((project) => [
      scopedProjectKey(project.environmentId, project.id),
      project.title,
    ]),
  );
  return selectRecentActivity(input.threads, input.sort).map((thread) => ({
    key: scopedThreadKey(thread.environmentId, thread.id),
    thread,
    projectTitle:
      projectTitleByKey.get(scopedProjectKey(thread.environmentId, thread.projectId)) ?? null,
    times: [
      {
        sort: "updated",
        label: resolve(SORT_LABELS.updated),
        age: age(thread.updatedAt, input.nowMs, resolve),
      },
      {
        sort: "prompt",
        label: resolve(SORT_LABELS.prompt),
        age: age(thread.latestUserMessageAt, input.nowMs, resolve),
      },
      {
        sort: "viewed",
        label: resolve(SORT_LABELS.viewed),
        age: age(thread.lastVisitedAt, input.nowMs, resolve),
      },
    ],
  }));
}
