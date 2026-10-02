import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as ServerConfig from "../config.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitHubActions from "./GitHubActions.ts";

const git = (cwd: string, ...args: string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const exitCode = yield* spawner.exitCode(
      ChildProcess.make("git", ["-c", "user.name=t3", "-c", "user.email=t3@test", ...args], {
        cwd,
      }),
    );
    expect(exitCode).toBe(0);
  }).pipe(Effect.scoped);

interface GhCall {
  readonly args: ReadonlyArray<string>;
  readonly stdin: string | undefined;
}

const RUN_ROW = {
  databaseId: 901,
  number: 12,
  attempt: 1,
  workflowName: "CI",
  displayTitle: "Add checkout",
  event: "push",
  status: "in_progress",
  conclusion: "",
  headSha: "abc123",
  url: "https://github.com/acme/app/actions/runs/901",
  createdAt: "2026-09-30T10:00:00Z",
  updatedAt: "2026-09-30T10:01:00Z",
};

/** Real git underneath; `gh` is recorded and answers run lists with one run. */
const withActions = <A, E>(
  body: (input: {
    readonly actions: GitHubActions.GitHubActions["Service"];
    readonly calls: GhCall[];
  }) => Effect.Effect<
    A,
    E,
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >,
) => {
  const calls: GhCall[] = [];
  return Effect.gen(function* () {
    const actions = yield* GitHubActions.GitHubActions;
    return yield* body({ actions, calls });
  }).pipe(
    Effect.provide(
      GitHubActions.layer.pipe(
        Layer.provide(GitVcsDriver.layer),
        Layer.provide(
          Layer.mock(GitHubCli.GitHubCli)({
            execute: (input) =>
              Effect.sync(() => {
                calls.push({ args: input.args, stdin: input.stdin });
                const stdout =
                  input.args[0] === "run" && input.args[1] === "list"
                    ? JSON.stringify([RUN_ROW])
                    : "";
                return { stdout, stderr: "", code: 0 } as never;
              }),
          }),
        ),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-gh-actions-config-" })),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );
};

/**
 * A fork checkout: `upstream` is the parent `gh` would guess, while the branch
 * tracks `feat/checkout` on `origin`, the fork. Optionally leaves it unpushed.
 */
const makeForkCheckout = (options: { readonly pushed: boolean; readonly originUrl?: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-gh-actions-" });
    yield* git(root, "init", "--initial-branch=main");
    yield* fs.makeDirectory(path.join(root, ".github", "workflows"), { recursive: true });
    yield* fs.writeFileString(
      path.join(root, ".github", "workflows", "deploy.yml"),
      "name: Deploy\non:\n  workflow_dispatch:\n    inputs:\n      target: { required: true }\n",
    );
    yield* fs.writeFileString(
      path.join(root, ".github", "workflows", "ci.yml"),
      "name: CI\non: [push]\n",
    );
    yield* git(root, "add", ".");
    yield* git(root, "commit", "-m", "init");
    yield* git(root, "remote", "add", "origin", options.originUrl ?? "git@github.com:acme/app.git");
    yield* git(root, "remote", "add", "upstream", "https://github.com/parent/app.git");
    yield* git(root, "switch", "-c", "local-checkout");
    yield* git(root, "config", "branch.local-checkout.remote", "origin");
    yield* git(root, "config", "branch.local-checkout.merge", "refs/heads/feat/checkout");
    if (options.pushed) yield* git(root, "update-ref", "refs/remotes/origin/feat/checkout", "HEAD");
    return root;
  });

describe("GitHubActions", () => {
  it.effect("lists the tracked branch's runs on the fork and its manual workflows", () =>
    withActions(({ actions, calls }) =>
      Effect.gen(function* () {
        const root = yield* makeForkCheckout({ pushed: true });
        const listed = yield* actions.list(root);
        expect(listed).toMatchObject({
          repository: "acme/app",
          branch: "feat/checkout",
          pushed: true,
          runs: [{ id: 901, status: "in_progress", conclusion: null, workflowName: "CI" }],
          workflows: [{ path: ".github/workflows/deploy.yml", name: "Deploy" }],
        });
        expect(calls[0]?.args).toEqual(
          expect.arrayContaining(["--repo", "acme/app", "--branch", "feat/checkout"]),
        );
      }),
    ).pipe(Effect.scoped),
  );

  it.effect("dispatches on the remote branch with inputs on stdin", () =>
    withActions(({ actions, calls }) =>
      Effect.gen(function* () {
        const root = yield* makeForkCheckout({ pushed: true });
        yield* actions.dispatch({
          cwd: root,
          workflow: ".github/workflows/deploy.yml",
          inputs: { target: "api" },
        });
        expect(calls).toEqual([
          {
            args: [
              "workflow",
              "run",
              "deploy.yml",
              "--repo",
              "acme/app",
              "--ref",
              "feat/checkout",
              "--json",
            ],
            stdin: '{"target":"api"}',
          },
        ]);

        const missing = yield* Effect.flip(
          actions.dispatch({ cwd: root, workflow: ".github/workflows/deploy.yml", inputs: {} }),
        );
        expect(missing.reason).toBe("invalid_input");
        const notManual = yield* Effect.flip(
          actions.dispatch({ cwd: root, workflow: ".github/workflows/ci.yml", inputs: {} }),
        );
        expect(notManual.reason).toBe("invalid_input");
        expect(calls).toHaveLength(1);
      }),
    ).pipe(Effect.scoped),
  );

  it.effect("refuses to dispatch a branch that is not pushed", () =>
    withActions(({ actions, calls }) =>
      Effect.gen(function* () {
        const root = yield* makeForkCheckout({ pushed: false });
        expect((yield* actions.list(root)).pushed).toBe(false);
        const error = yield* Effect.flip(
          actions.dispatch({
            cwd: root,
            workflow: ".github/workflows/deploy.yml",
            inputs: { target: "api" },
          }),
        );
        expect(error.reason).toBe("not_pushed");
        expect(calls.some((call) => call.args[0] === "workflow")).toBe(false);
      }),
    ).pipe(Effect.scoped),
  );

  it.effect("reports a non-GitHub remote without calling gh", () =>
    withActions(({ actions, calls }) =>
      Effect.gen(function* () {
        const root = yield* makeForkCheckout({
          pushed: true,
          originUrl: "git@gitlab.com:acme/app.git",
        });
        const listed = yield* actions.list(root);
        expect(listed).toMatchObject({ repository: null, branch: "feat/checkout", runs: [] });
        expect((yield* Effect.flip(actions.cancel(root, 901))).reason).toBe("not_github");
        expect(calls).toEqual([]);
      }),
    ).pipe(Effect.scoped),
  );
});
