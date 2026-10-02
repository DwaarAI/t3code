import { type EnvironmentId, type GitHubWorkflowRun, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** How often an open Actions view re-reads the branch's runs. */
export const GITHUB_ACTIONS_REFRESH_INTERVAL_MS = 15_000;

/**
 * A branch's GitHub Actions runs and manual workflows. Polled only while a
 * view holds the query; each change refreshes it right away.
 */
export function createGitHubActionsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:github-actions:list",
    tag: WS_METHODS.githubActionsList,
    staleTimeMs: 10_000,
    idleTtlMs: 30_000,
    refreshIntervalMs: GITHUB_ACTIONS_REFRESH_INTERVAL_MS,
  });
  const refreshList = (
    target: { readonly environmentId: EnvironmentId; readonly input: { readonly cwd: string } },
    registry: { readonly refresh: (atom: Atom.Atom<unknown>) => void },
  ) =>
    Effect.sync(() =>
      registry.refresh(
        list({ environmentId: target.environmentId, input: { cwd: target.input.cwd } }),
      ),
    );
  return {
    list,
    dispatch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github-actions:dispatch",
      tag: WS_METHODS.githubActionsDispatch,
      onSettled: refreshList,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github-actions:cancel",
      tag: WS_METHODS.githubActionsCancel,
      onSettled: refreshList,
    }),
    rerun: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:github-actions:rerun",
      tag: WS_METHODS.githubActionsRerun,
      onSettled: refreshList,
    }),
  };
}

export type WorkflowRunState = "running" | "success" | "failure" | "cancelled" | "skipped";

/** One display state per run, folding GitHub's status and conclusion together. */
export function workflowRunState(run: Pick<GitHubWorkflowRun, "status" | "conclusion">) {
  if (run.status !== "completed") return "running" satisfies WorkflowRunState;
  switch (run.conclusion) {
    case "success":
      return "success" satisfies WorkflowRunState;
    case "cancelled":
      return "cancelled" satisfies WorkflowRunState;
    case "skipped":
    case "neutral":
      return "skipped" satisfies WorkflowRunState;
    default:
      return "failure" satisfies WorkflowRunState;
  }
}

/**
 * The newest run of each workflow, newest first: the branch's current CI
 * picture, where older attempts of the same workflow are history.
 */
export function latestRunPerWorkflow(
  runs: ReadonlyArray<GitHubWorkflowRun>,
): ReadonlyArray<GitHubWorkflowRun> {
  const seen = new Set<string>();
  return [...runs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .filter((run) => {
      if (seen.has(run.workflowName)) return false;
      seen.add(run.workflowName);
      return true;
    });
}
