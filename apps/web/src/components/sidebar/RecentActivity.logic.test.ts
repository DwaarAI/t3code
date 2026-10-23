import { EnvironmentId, ProjectId, ThreadId, type Folder } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildRecentActivityRows, compactRelativeTime } from "./RecentActivity.logic";

const ENV = EnvironmentId.make("env-1");
const OTHER_ENV = EnvironmentId.make("env-2");
const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

type Shell = Parameters<typeof buildRecentActivityRows>[0]["threads"][number];

function thread(id: string, overrides: Partial<Omit<Shell, "id" | "title">> = {}): Shell {
  return {
    environmentId: ENV,
    id: ThreadId.make(id),
    projectId: ProjectId.make("project-1"),
    title: `Thread ${id}`,
    worktreePath: null,
    updatedAt: minutesAgo(30),
    latestUserMessageAt: minutesAgo(40),
    lastVisitedAt: minutesAgo(10),
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function build(
  threads: ReadonlyArray<Shell>,
  overrides: Partial<Parameters<typeof buildRecentActivityRows>[0]> = {},
) {
  return buildRecentActivityRows({
    threads,
    localLastVisitedAtByKey: {},
    projectTitleByKey: new Map([[`${ENV}:project-1`, "Web app"]]),
    folders: [],
    sort: "updated",
    nowMs: NOW,
    ...overrides,
  });
}

describe("buildRecentActivityRows", () => {
  it("highlights the active sort and labels missing times with a dash", () => {
    const [row] = build([thread("a", { latestUserMessageAt: null })], { sort: "prompt" });
    expect(row?.times.map(({ label, value, active }) => ({ label, value, active }))).toEqual([
      { label: "Updated", value: "30m", active: false },
      { label: "Prompt", value: "—", active: true },
      { label: "Viewed", value: "10m", active: false },
    ]);
  });

  it("uses this browser's visits only for servers without visited tracking", () => {
    const local = { [`${ENV}:legacy`]: minutesAgo(1), [`${ENV}:rewound`]: minutesAgo(1) };
    // An environment that predates visited tracking leaves the field out.
    const { lastVisitedAt: _untracked, ...legacy } = thread("legacy");
    const rows = build(
      [
        legacy,
        // A server-tracked null (never viewed, or marked unread) wins over a local visit.
        thread("rewound", { lastVisitedAt: null }),
      ],
      { localLastVisitedAtByKey: local, sort: "viewed" },
    );
    expect(rows.map((row) => row.key)).toEqual([`${ENV}:legacy`]);
    expect(rows[0]?.times.find((time) => time.sort === "viewed")?.value).toBe("1m");
  });

  it("keys rows per environment and names folder threads by their folder", () => {
    const folder = {
      name: "October rebase",
      rootProjectId: ProjectId.make("folder-project"),
      members: [],
    } as unknown as Folder;
    const rows = build(
      [
        thread("same", { updatedAt: minutesAgo(1) }),
        thread("same", { environmentId: OTHER_ENV, updatedAt: minutesAgo(2) }),
        thread("session", {
          projectId: ProjectId.make("folder-project"),
          updatedAt: minutesAgo(3),
        }),
      ],
      { folders: [{ environmentId: ENV, foldersDir: "/f", guidesDir: "/g", folders: [folder] }] },
    );
    expect(rows.map((row) => [row.key, row.context])).toEqual([
      [`${ENV}:same`, "Web app"],
      [`${OTHER_ENV}:same`, null],
      [`${ENV}:session`, "October rebase"],
    ]);
  });
});

describe("compactRelativeTime", () => {
  it("shortens the shared relative label", () => {
    expect(compactRelativeTime(minutesAgo(0), NOW)).toBe("now");
    expect(compactRelativeTime(minutesAgo(180), NOW)).toBe("3h");
    expect(compactRelativeTime(null, NOW)).toBe("—");
  });
});
