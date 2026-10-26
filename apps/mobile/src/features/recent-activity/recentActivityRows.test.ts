import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { buildRecentActivityRows } from "./recentActivityRows";

const local = EnvironmentId.make("environment-local");
const remote = EnvironmentId.make("environment-remote");
const projectId = ProjectId.make("project-app");
const nowMs = Date.parse("2026-06-01T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(nowMs - minutes * 60_000).toISOString();

function makeProject(environmentId: EnvironmentId, title: string): EnvironmentProject {
  return {
    environmentId,
    id: projectId,
    title,
    workspaceRoot: `/workspaces/${title}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

const threads = [
  makeThreadShellFixture({
    environmentId: local,
    id: ThreadId.make("a"),
    projectId,
    title: "Local thread",
    updatedAt: minutesAgo(2),
    latestUserMessageAt: minutesAgo(5),
    lastVisitedAt: minutesAgo(30),
  }),
  // Same thread id in another environment: a distinct row.
  makeThreadShellFixture({
    environmentId: remote,
    id: ThreadId.make("a"),
    projectId,
    title: "Remote thread",
    updatedAt: minutesAgo(90),
    latestUserMessageAt: null,
    lastVisitedAt: minutesAgo(1),
  }),
  makeThreadShellFixture({
    environmentId: local,
    id: ThreadId.make("never-opened"),
    projectId,
    title: "Never opened",
    updatedAt: minutesAgo(0),
    lastVisitedAt: null,
  }),
];
const projects = [makeProject(local, "app"), makeProject(remote, "app-remote")];

describe("buildRecentActivityRows", () => {
  it("keys rows by environment and thread and labels each with its project", () => {
    const rows = buildRecentActivityRows({ threads, projects, sort: "updated", nowMs });
    expect(rows.map((row) => [row.key, row.projectTitle])).toEqual([
      [`${local}:a`, "app"],
      [`${remote}:a`, "app-remote"],
    ]);
  });

  it("shows all three ages in a fixed order, with a dash for a missing time", () => {
    const rows = buildRecentActivityRows({ threads, projects, sort: "viewed", nowMs });
    expect(rows.map((row) => row.times.map((time) => `${time.label} ${time.age}`))).toEqual([
      ["Updated 1h", "Prompt —", "Viewed 1m"],
      ["Updated 2m", "Prompt 5m", "Viewed 30m"],
    ]);
  });

  it("falls back to no project label when the project is not loaded", () => {
    const [row] = buildRecentActivityRows({ threads, projects: [], sort: "viewed", nowMs });
    expect(row?.projectTitle).toBeNull();
  });
});
