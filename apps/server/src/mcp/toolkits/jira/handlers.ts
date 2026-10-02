import type { JiraTransition } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerConfig from "../../../config.ts";
import * as FolderService from "../../../folder/FolderService.ts";
import { resolveFolderScope } from "../../../folder/folderLayout.ts";
import * as JiraService from "../../../jira/JiraService.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { JiraToolError, JiraToolkit } from "./tools.ts";

const toolError = (cause: { readonly message: string }) =>
  new JiraToolError({ detail: cause.message });

/** The transition whose name or target status matches, ignoring case. */
export function findTransition(
  transitions: ReadonlyArray<JiraTransition>,
  status: string,
): JiraTransition | null {
  const wanted = status.trim().toLowerCase();
  return (
    transitions.find((transition) => transition.toStatus.toLowerCase() === wanted) ??
    transitions.find((transition) => transition.name.toLowerCase() === wanted) ??
    null
  );
}

const make = Effect.gen(function* () {
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const folders = yield* FolderService.FolderService;
  const jira = yield* JiraService.JiraService;
  const config = yield* ServerConfig.ServerConfig;

  const requireJira = McpInvocationContext.requireMcpCapability("jira");

  /** The folder slug for the thread's working directory, if it runs in one. */
  const threadFolderSlug = Effect.gen(function* () {
    const scope = yield* requireJira;
    const thread = Option.getOrNull(
      yield* snapshots.getThreadShellById(scope.threadId).pipe(Effect.mapError(toolError)),
    );
    if (thread === null) return null;
    const project = Option.getOrNull(
      yield* snapshots.getProjectShellById(thread.projectId).pipe(Effect.mapError(toolError)),
    );
    const cwd = thread.worktreePath ?? project?.workspaceRoot;
    return resolveFolderScope(cwd ?? undefined, config.foldersDir)?.slug ?? null;
  });

  return JiraToolkit.of({
    list_folder_jira_tickets: () =>
      Effect.gen(function* () {
        const slug = yield* threadFolderSlug;
        if (slug === null) return { folder: null, tickets: [] };
        const listed = yield* folders.list().pipe(Effect.mapError(toolError));
        const folder = listed.folders.find((candidate) => candidate.slug === slug);
        if (!folder) return { folder: null, tickets: [] };
        const tickets = yield* jira
          .summaries(folder.jiraIssues ?? [])
          .pipe(Effect.mapError(toolError));
        return { folder: folder.name, tickets };
      }),
    get_jira_ticket: ({ key }) =>
      requireJira.pipe(Effect.andThen(jira.getIssue(key).pipe(Effect.mapError(toolError)))),
    search_jira_tickets: ({ query }) =>
      requireJira.pipe(
        Effect.andThen(jira.search(query).pipe(Effect.mapError(toolError))),
        Effect.map((tickets) => ({ tickets })),
      ),
    comment_on_jira_ticket: ({ key, body }) =>
      requireJira.pipe(Effect.andThen(jira.addComment(key, body).pipe(Effect.mapError(toolError)))),
    change_jira_ticket_status: ({ key, status }) =>
      Effect.gen(function* () {
        yield* requireJira;
        const issue = yield* jira.getIssue(key).pipe(Effect.mapError(toolError));
        if (issue.status.toLowerCase() === status.trim().toLowerCase()) return issue;
        const transition = findTransition(issue.transitions, status);
        if (transition === null) {
          const options = issue.transitions.map((entry) => entry.toStatus).join(", ");
          return yield* new JiraToolError({
            detail: `${key} cannot move to "${status}" now. Available: ${options || "none"}.`,
          });
        }
        return yield* jira.transition(key, transition.id).pipe(Effect.mapError(toolError));
      }),
  });
});

export const JiraToolkitHandlersLive = JiraToolkit.toLayer(make);
