import { describe, expect, it } from "@effect/vitest";

import { dispatchInputs, readDispatchableWorkflow, resolveRemoteBranch } from "./workflowFile.ts";

const PATH = ".github/workflows/deploy.yml";

describe("readDispatchableWorkflow", () => {
  it("reads a manual trigger with typed inputs", () => {
    const workflow = readDispatchableWorkflow(
      PATH,
      [
        "name: Deploy",
        "on:",
        "  push:",
        "    branches: [main]",
        "  workflow_dispatch:",
        "    inputs:",
        "      environment:",
        "        description: Where to deploy",
        "        type: choice",
        "        required: true",
        "        options: [staging, production]",
        "        default: staging",
        "      dry_run:",
        "        type: boolean",
        "        default: false",
        "      replicas:",
        "        type: number",
      ].join("\n"),
    );
    expect(workflow).toEqual({
      path: PATH,
      name: "Deploy",
      inputs: [
        {
          name: "environment",
          description: "Where to deploy",
          type: "choice",
          required: true,
          default: "staging",
          options: ["staging", "production"],
        },
        {
          name: "dry_run",
          description: null,
          type: "boolean",
          required: false,
          default: "false",
          options: [],
        },
        {
          name: "replicas",
          description: null,
          type: "number",
          required: false,
          default: null,
          options: [],
        },
      ],
    });
  });

  it("accepts the bare string and list trigger forms", () => {
    expect(readDispatchableWorkflow(PATH, "on: workflow_dispatch\n")).toEqual({
      path: PATH,
      name: "deploy.yml",
      inputs: [],
    });
    expect(readDispatchableWorkflow(PATH, "name: CI\non: [push, workflow_dispatch]\n")?.name).toBe(
      "CI",
    );
    expect(readDispatchableWorkflow(PATH, "on:\n  workflow_dispatch:\n")?.inputs).toEqual([]);
  });

  it("skips workflows without a manual trigger and unparseable files", () => {
    expect(readDispatchableWorkflow(PATH, "on: [push, pull_request]\n")).toBeNull();
    expect(readDispatchableWorkflow(PATH, "on:\n  push: {}\n")).toBeNull();
    expect(readDispatchableWorkflow(PATH, "on: [\n")).toBeNull();
  });
});

describe("dispatchInputs", () => {
  const workflow = readDispatchableWorkflow(
    PATH,
    [
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      target: { required: true }",
      "      note: { required: false }",
      "      level: { default: info }",
    ].join("\n"),
  )!;

  it("fills defaults, drops empty optional values and ignores undeclared keys", () => {
    expect(dispatchInputs(workflow, { target: "api", note: "", extra: "x" })).toEqual({
      inputs: { target: "api", level: "info" },
    });
  });

  it("reports a missing required value", () => {
    expect(dispatchInputs(workflow, { note: "hi" })).toEqual({ missing: "target" });
  });
});

describe("resolveRemoteBranch", () => {
  it("follows the branch's upstream, which may differ in name and remote", () => {
    expect(
      resolveRemoteBranch({
        branch: "local-name",
        upstreamRemote: "fork",
        upstreamMerge: "refs/heads/feat/x",
        fallbackRemote: "origin",
      }),
    ).toEqual({ remote: "fork", branch: "feat/x" });
  });

  it("falls back to the same name on the fallback remote without an upstream", () => {
    const fallback = { remote: "origin", branch: "feat/y" };
    expect(
      resolveRemoteBranch({
        branch: "feat/y",
        upstreamRemote: null,
        upstreamMerge: null,
        fallbackRemote: "origin",
      }),
    ).toEqual(fallback);
    // A branch tracking another local branch has remote ".".
    expect(
      resolveRemoteBranch({
        branch: "feat/y",
        upstreamRemote: ".",
        upstreamMerge: "refs/heads/main",
        fallbackRemote: "origin",
      }),
    ).toEqual(fallback);
  });
});
