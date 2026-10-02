import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * GitHub Actions for the branch checked out in a workspace: its recent
 * workflow runs, and the workflows it can start by hand (`workflow_dispatch`).
 * The server reads them with its `gh` login, addressing the repository the
 * branch is pushed to rather than whatever `gh` would guess from the remotes.
 */
export const GitHubActionsTargetInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type GitHubActionsTargetInput = typeof GitHubActionsTargetInput.Type;

export const GitHubWorkflowRun = Schema.Struct({
  id: PositiveInt,
  number: NonNegativeInt,
  attempt: NonNegativeInt,
  workflowName: Schema.String,
  title: Schema.String,
  /** What started the run, such as `push`, `pull_request` or `workflow_dispatch`. */
  event: Schema.String,
  /** `queued`, `in_progress`, `completed`, `waiting`, `requested` or `pending`. */
  status: Schema.String,
  /** Set once completed: `success`, `failure`, `cancelled`, `skipped`, ... */
  conclusion: Schema.NullOr(Schema.String),
  headSha: Schema.String,
  url: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type GitHubWorkflowRun = typeof GitHubWorkflowRun.Type;

export const GitHubWorkflowInputType = Schema.Literals([
  "string",
  "boolean",
  "choice",
  "number",
  "environment",
]);
export type GitHubWorkflowInputType = typeof GitHubWorkflowInputType.Type;

export const GitHubWorkflowInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  type: GitHubWorkflowInputType,
  required: Schema.Boolean,
  /** The declared default, as the string the dispatch would send. */
  default: Schema.NullOr(Schema.String),
  /** Allowed values of a `choice` input. */
  options: Schema.Array(Schema.String),
});
export type GitHubWorkflowInput = typeof GitHubWorkflowInput.Type;

/** A workflow in the branch's `.github/workflows` that declares `workflow_dispatch`. */
export const GitHubDispatchableWorkflow = Schema.Struct({
  /** Repository-relative path, such as `.github/workflows/deploy.yml`. */
  path: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  inputs: Schema.Array(GitHubWorkflowInput),
});
export type GitHubDispatchableWorkflow = typeof GitHubDispatchableWorkflow.Type;

export const GitHubActionsListResult = Schema.Struct({
  /** `owner/name` the branch is pushed to; null when that remote is not on GitHub. */
  repository: Schema.NullOr(TrimmedNonEmptyString),
  /** The branch name on that remote; null on a detached HEAD. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
  /** Whether the branch exists on the remote. Runs and dispatches need it there. */
  pushed: Schema.Boolean,
  runs: Schema.Array(GitHubWorkflowRun),
  workflows: Schema.Array(GitHubDispatchableWorkflow),
});
export type GitHubActionsListResult = typeof GitHubActionsListResult.Type;

export const GitHubActionsDispatchInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  /** Repository-relative workflow path from `workflows`. */
  workflow: TrimmedNonEmptyString,
  inputs: Schema.Record(Schema.String, Schema.String),
});
export type GitHubActionsDispatchInput = typeof GitHubActionsDispatchInput.Type;

export const GitHubActionsRunInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  runId: PositiveInt,
});
export type GitHubActionsRunInput = typeof GitHubActionsRunInput.Type;

export const GitHubActionsRerunInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  runId: PositiveInt,
  /** Re-run only the failed jobs and their dependents. */
  failedOnly: Schema.Boolean,
});
export type GitHubActionsRerunInput = typeof GitHubActionsRerunInput.Type;

export const GitHubActionsErrorReason = Schema.Literals([
  "not_github",
  "no_branch",
  "not_pushed",
  "invalid_input",
  "git_failed",
  "github_failed",
]);
export type GitHubActionsErrorReason = typeof GitHubActionsErrorReason.Type;

export class GitHubActionsError extends Schema.TaggedError<GitHubActionsError>()(
  "GitHubActionsError",
  {
    reason: GitHubActionsErrorReason,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
