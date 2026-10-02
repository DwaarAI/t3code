/**
 * GitHubActions - A workspace branch's GitHub Actions: recent workflow runs,
 * the workflows it can start by hand, and dispatch, cancel and re-run. Reads
 * the branch's remote from git so a fork checkout addresses the fork, not the
 * parent `gh` would pick, and calls `gh` with the server's login.
 */
import {
  type GitHubActionsListResult,
  GitHubActionsError,
  type GitHubActionsErrorReason,
  type GitHubDispatchableWorkflow,
} from "@t3tools/contracts";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  dispatchInputs,
  isWorkflowFileName,
  readDispatchableWorkflow,
  resolveRemoteBranch,
  RUN_LIST_FIELDS,
  toWorkflowRun,
} from "./workflowFile.ts";

const RUN_LIMIT = 30;

export class GitHubActions extends Context.Service<
  GitHubActions,
  {
    readonly list: (cwd: string) => Effect.Effect<GitHubActionsListResult, GitHubActionsError>;
    readonly dispatch: (input: {
      readonly cwd: string;
      readonly workflow: string;
      readonly inputs: Readonly<Record<string, string>>;
    }) => Effect.Effect<void, GitHubActionsError>;
    readonly cancel: (cwd: string, runId: number) => Effect.Effect<void, GitHubActionsError>;
    readonly rerun: (
      cwd: string,
      runId: number,
      failedOnly: boolean,
    ) => Effect.Effect<void, GitHubActionsError>;
  }
>()("t3/githubActions/GitHubActions") {}

const RunListJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      databaseId: Schema.Number,
      number: Schema.Number,
      attempt: Schema.Number,
      workflowName: Schema.String,
      displayTitle: Schema.String,
      event: Schema.String,
      status: Schema.String,
      conclusion: Schema.String,
      headSha: Schema.String,
      url: Schema.String,
      createdAt: Schema.String,
      updatedAt: Schema.String,
    }),
  ),
);

const decodeRunList = Schema.decodeEffect(RunListJson);
const encodeDispatchInputs = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

const failure =
  (reason: GitHubActionsErrorReason, detail: string) => (cause: { readonly message: string }) =>
    new GitHubActionsError({ reason, detail: `${detail}: ${cause.message}`, cause });

interface BranchTarget {
  readonly root: string;
  readonly repository: string | null;
  readonly remote: string;
  readonly branch: string | null;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gh = yield* GitHubCli.GitHubCli;

  const gitOutput = (cwd: string, args: ReadonlyArray<string>) =>
    git
      .execute({ operation: "GitHubActions.git", cwd, args, allowNonZeroExit: true })
      .pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "")));

  const resolveTarget = (cwd: string) =>
    Effect.gen(function* () {
      const root = yield* gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
      if (root === "") {
        return yield* new GitHubActionsError({
          reason: "git_failed",
          detail: `${cwd} is not a git repository.`,
        });
      }
      const localBranch = yield* gitOutput(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      const fallbackRemote = yield* git.resolvePrimaryRemoteName(root);
      const { remote, branch } =
        localBranch === ""
          ? { remote: fallbackRemote, branch: null }
          : resolveRemoteBranch({
              branch: localBranch,
              upstreamRemote:
                (yield* gitOutput(root, ["config", "--get", `branch.${localBranch}.remote`])) ||
                null,
              upstreamMerge:
                (yield* gitOutput(root, ["config", "--get", `branch.${localBranch}.merge`])) ||
                null,
              fallbackRemote,
            });
      const url = yield* gitOutput(root, ["remote", "get-url", remote]);
      return {
        root,
        repository: parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url),
        remote,
        branch,
      } satisfies BranchTarget;
    }).pipe(
      Effect.catchTag("GitCommandError", (cause) =>
        Effect.fail(failure("git_failed", `Could not read the branch in ${cwd}`)(cause)),
      ),
    );

  /** A target that `gh` can act on: on GitHub, on a branch. */
  const requireTarget = (cwd: string) =>
    Effect.gen(function* () {
      const target = yield* resolveTarget(cwd);
      if (target.repository === null) {
        return yield* new GitHubActionsError({
          reason: "not_github",
          detail: `The ${target.remote} remote is not a GitHub repository.`,
        });
      }
      return { ...target, repository: target.repository };
    });

  const run = (cwd: string, detail: string, args: ReadonlyArray<string>, stdin?: string) =>
    gh.execute({ cwd, args, ...(stdin === undefined ? {} : { stdin }) }).pipe(
      Effect.map((output) => output.stdout),
      Effect.mapError(failure("github_failed", detail)),
    );

  const readWorkflows = (root: string) =>
    Effect.gen(function* () {
      const directory = path.join(root, ".github", "workflows");
      const names = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
      const workflows: GitHubDispatchableWorkflow[] = [];
      for (const name of names.filter(isWorkflowFileName).toSorted()) {
        const source = yield* fs
          .readFileString(path.join(directory, name))
          .pipe(Effect.orElseSucceed(() => ""));
        const workflow = readDispatchableWorkflow(`.github/workflows/${name}`, source);
        if (workflow) workflows.push(workflow);
      }
      return workflows;
    });

  const isPushed = (target: BranchTarget) =>
    target.branch === null
      ? Effect.succeed(false)
      : gitOutput(target.root, [
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/remotes/${target.remote}/${target.branch}`,
        ]).pipe(
          Effect.map((sha) => sha !== ""),
          Effect.orElseSucceed(() => false),
        );

  const list: GitHubActions["Service"]["list"] = (cwd) =>
    Effect.gen(function* () {
      const target = yield* resolveTarget(cwd);
      const workflows = yield* readWorkflows(target.root);
      const pushed = yield* isPushed(target);
      if (target.repository === null || target.branch === null) {
        return {
          repository: target.repository,
          branch: target.branch,
          pushed,
          runs: [],
          workflows,
        };
      }
      const raw = yield* run(target.root, `Could not list workflow runs for ${target.branch}`, [
        "run",
        "list",
        "--repo",
        target.repository,
        "--branch",
        target.branch,
        "--limit",
        String(RUN_LIMIT),
        "--json",
        RUN_LIST_FIELDS,
      ]);
      const rows = yield* decodeRunList(raw).pipe(
        Effect.mapError(failure("github_failed", "Unexpected workflow run list")),
      );
      return {
        repository: target.repository,
        branch: target.branch,
        pushed,
        runs: rows.map(toWorkflowRun),
        workflows,
      };
    });

  const dispatch: GitHubActions["Service"]["dispatch"] = (input) =>
    Effect.gen(function* () {
      const target = yield* requireTarget(input.cwd);
      if (target.branch === null) {
        return yield* new GitHubActionsError({
          reason: "no_branch",
          detail: "Check out a branch to run a workflow on it.",
        });
      }
      if (!(yield* isPushed(target))) {
        return yield* new GitHubActionsError({
          reason: "not_pushed",
          detail: `Push ${target.branch} to ${target.remote} before running a workflow on it.`,
        });
      }
      const workflow = (yield* readWorkflows(target.root)).find(
        (candidate) => candidate.path === input.workflow,
      );
      if (!workflow) {
        return yield* new GitHubActionsError({
          reason: "invalid_input",
          detail: `${input.workflow} cannot be run by hand on this branch.`,
        });
      }
      const resolved = dispatchInputs(workflow, input.inputs);
      if ("missing" in resolved) {
        return yield* new GitHubActionsError({
          reason: "invalid_input",
          detail: `${workflow.name} needs a value for ${resolved.missing}.`,
        });
      }
      const stdin = yield* encodeDispatchInputs(resolved.inputs).pipe(
        Effect.mapError(failure("invalid_input", `Could not encode inputs for ${workflow.name}`)),
      );
      yield* run(
        target.root,
        `Could not run ${workflow.name}`,
        [
          "workflow",
          "run",
          workflow.path.slice(workflow.path.lastIndexOf("/") + 1),
          "--repo",
          target.repository,
          "--ref",
          target.branch,
          "--json",
        ],
        stdin,
      );
    });

  const cancel: GitHubActions["Service"]["cancel"] = (cwd, runId) =>
    Effect.gen(function* () {
      const target = yield* requireTarget(cwd);
      yield* run(target.root, `Could not cancel run ${runId}`, [
        "run",
        "cancel",
        String(runId),
        "--repo",
        target.repository,
      ]);
    });

  const rerun: GitHubActions["Service"]["rerun"] = (cwd, runId, failedOnly) =>
    Effect.gen(function* () {
      const target = yield* requireTarget(cwd);
      yield* run(target.root, `Could not re-run run ${runId}`, [
        "run",
        "rerun",
        String(runId),
        "--repo",
        target.repository,
        ...(failedOnly ? ["--failed"] : []),
      ]);
    });

  return GitHubActions.of({ list, dispatch, cancel, rerun });
});

export const layer = Layer.effect(GitHubActions, make);
