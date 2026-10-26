import { selectRecentActivity } from "@t3tools/client-runtime/recent-activity";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { RecentActivitySort } from "@t3tools/contracts/settings";

import type { SegmentedControlProps } from "../../components/ui/SegmentedControl.types";
import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import { relativeTime } from "../../lib/time";

export const RECENT_ACTIVITY_SORT_OPTIONS: SegmentedControlProps<RecentActivitySort>["options"] = [
  { value: "updated", label: "Updated", accessibilityLabel: "Sort by last updated" },
  { value: "prompt", label: "Prompt", accessibilityLabel: "Sort by last prompt" },
  { value: "viewed", label: "Viewed", accessibilityLabel: "Sort by last viewed" },
];

export interface RecentActivityTime {
  readonly sort: RecentActivitySort;
  readonly label: string;
  /** Relative age such as "5m", or "—" when the thread has no such time. */
  readonly age: string;
}

export interface RecentActivityRow {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly projectTitle: string | null;
  /** Always Updated, Prompt, Viewed, so the columns stay put when the sort changes. */
  readonly times: readonly [RecentActivityTime, RecentActivityTime, RecentActivityTime];
}

const age = (iso: string | null | undefined, nowMs: number) =>
  iso ? relativeTime(iso, nowMs) : "—";

export function buildRecentActivityRows(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly sort: RecentActivitySort;
  readonly nowMs: number;
}): ReadonlyArray<RecentActivityRow> {
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
      { sort: "updated", label: "Updated", age: age(thread.updatedAt, input.nowMs) },
      { sort: "prompt", label: "Prompt", age: age(thread.latestUserMessageAt, input.nowMs) },
      { sort: "viewed", label: "Viewed", age: age(thread.lastVisitedAt, input.nowMs) },
    ],
  }));
}
