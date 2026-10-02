import {
  type EnvironmentId,
  type JiraIssueSummary,
  type JiraStatusCategory,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/**
 * Jira tickets through the environment's Jira connection. Tickets are read on
 * demand; every change refreshes the ticket it touched.
 */
export function createJiraEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const status = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:jira:status",
    tag: WS_METHODS.jiraStatus,
    staleTimeMs: 60_000,
  });
  const search = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:jira:search",
    tag: WS_METHODS.jiraSearch,
    staleTimeMs: 30_000,
    idleTtlMs: 60_000,
  });
  const issue = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:jira:issue",
    tag: WS_METHODS.jiraGetIssue,
    staleTimeMs: 30_000,
    idleTtlMs: 60_000,
  });
  const refreshIssue = (
    target: { readonly environmentId: EnvironmentId; readonly input: { readonly key: string } },
    registry: { readonly refresh: (atom: Atom.Atom<unknown>) => void },
  ) =>
    Effect.sync(() =>
      registry.refresh(
        issue({ environmentId: target.environmentId, input: { key: target.input.key } }),
      ),
    );
  return {
    status,
    search,
    issue,
    configure: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:configure",
      tag: WS_METHODS.jiraConfigure,
      onSettled: (target, registry) =>
        Effect.sync(() =>
          registry.refresh(status({ environmentId: target.environmentId, input: {} })),
        ),
    }),
    updateIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:update-issue",
      tag: WS_METHODS.jiraUpdateIssue,
      onSettled: refreshIssue,
    }),
    addComment: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:add-comment",
      tag: WS_METHODS.jiraAddComment,
      onSettled: refreshIssue,
    }),
    transition: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:jira:transition",
      tag: WS_METHODS.jiraTransition,
      onSettled: refreshIssue,
    }),
  };
}

/** JQL for a folder's attached tickets, or null when it has none. */
export const folderTicketsQuery = (keys: ReadonlyArray<string>): string | null =>
  keys.length === 0 ? null : `key in (${keys.join(", ")})`;

/** Search results in the order the folder attached them; missing tickets are dropped. */
export function orderFolderTickets(
  keys: ReadonlyArray<string>,
  found: ReadonlyArray<JiraIssueSummary>,
): ReadonlyArray<JiraIssueSummary> {
  return keys.flatMap((key) => found.find((issue) => issue.key === key) ?? []);
}

/** Tone for a status pill: Jira's three status categories. */
export function jiraStatusTone(category: JiraStatusCategory): "neutral" | "progress" | "done" {
  return category === "done" ? "done" : category === "indeterminate" ? "progress" : "neutral";
}
