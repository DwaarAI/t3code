import type { GitHubWorkflowRun } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { latestRunPerWorkflow, workflowRunState } from "./githubActions.ts";

const run = (overrides: Partial<GitHubWorkflowRun>): GitHubWorkflowRun => ({
  id: 1,
  number: 1,
  attempt: 1,
  workflowName: "CI",
  title: "Commit",
  event: "push",
  status: "completed",
  conclusion: "success",
  headSha: "abc",
  url: "https://github.com/acme/app/actions/runs/1",
  createdAt: "2026-09-30T10:00:00Z",
  updatedAt: "2026-09-30T10:00:00Z",
  ...overrides,
});

describe("workflowRunState", () => {
  it("treats every unfinished status as running", () => {
    for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
      expect(workflowRunState(run({ status, conclusion: null }))).toBe("running");
    }
  });

  it("maps conclusions, counting timeouts and action_required as failures", () => {
    expect(workflowRunState(run({ conclusion: "success" }))).toBe("success");
    expect(workflowRunState(run({ conclusion: "cancelled" }))).toBe("cancelled");
    expect(workflowRunState(run({ conclusion: "skipped" }))).toBe("skipped");
    expect(workflowRunState(run({ conclusion: "timed_out" }))).toBe("failure");
    expect(workflowRunState(run({ conclusion: "action_required" }))).toBe("failure");
  });
});

describe("latestRunPerWorkflow", () => {
  it("keeps the newest run of each workflow, newest first", () => {
    const runs = [
      run({ id: 1, workflowName: "CI", createdAt: "2026-09-30T09:00:00Z" }),
      run({ id: 2, workflowName: "Deploy", createdAt: "2026-09-30T10:00:00Z" }),
      run({ id: 3, workflowName: "CI", createdAt: "2026-09-30T11:00:00Z" }),
    ];
    expect(latestRunPerWorkflow(runs).map((entry) => entry.id)).toEqual([3, 2]);
  });
});
