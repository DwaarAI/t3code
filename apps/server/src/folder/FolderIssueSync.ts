/**
 * FolderIssueSync - Turns labeled GitHub issues into folders and moves issue
 * status labels as a folder's pull requests open and merge.
 *
 * Off unless the `githubIssueFolders` setting is on. It polls with the
 * server's `gh` login, so it needs no public URL or webhook. It never starts an
 * agent: a folder waits with the issue snapshot and a suggested first prompt
 * until someone opens it in T3 Code.
 */
import type { Folder, OrchestrationProjectShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as FolderGitHub from "./FolderGitHub.ts";
import * as FolderService from "./FolderService.ts";
import { type IssueKey, issueKeyOf, nextAutomaticStatus, parseT3Block } from "./githubIssues.ts";

const POLL_INTERVAL = "2 minutes";

/** `owner/name` for a project whose origin is on GitHub. */
function githubRepository(project: OrchestrationProjectShell): string | null {
  const identity = project.repositoryIdentity;
  if (!identity || identity.provider !== "github") return null;
  if (identity.owner && identity.name) return `${identity.owner}/${identity.name}`;
  return identity.displayName ?? null;
}

/** @public One sync pass; exported so tests can drive it without the schedule. */
export const makeSyncOnce = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const folders = yield* FolderService.FolderService;
  const github = yield* FolderGitHub.FolderGitHub;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  // Issues still carrying the trigger label that must not be retried every
  // pass: authors who may not push, and failures whose label swap also failed.
  // A server restart retries them. Failed issues normally lose the trigger
  // label instead, so adding it again retries them.
  const skipped = new Set<string>();

  const startFolder = (input: {
    readonly repository: string;
    readonly issue: FolderGitHub.LabeledIssue;
    readonly label: string;
    readonly projectsByRepository: ReadonlyMap<string, OrchestrationProjectShell>;
  }) =>
    Effect.gen(function* () {
      const { repository, issue, label } = input;
      const key: IssueKey = { repository, number: issue.number };
      if (!issue.author || !(yield* github.canWrite(repository, issue.author))) {
        // The issue body becomes agent instructions, so only people who could
        // push the change themselves may write it.
        skipped.add(issueKeyOf(key));
        return yield* Effect.logInfo(
          `Skipping ${repository}#${issue.number}: its author cannot push to ${repository}.`,
        );
      }
      const block = parseT3Block(issue.body);
      const repositories = block?.repos?.length ? block.repos : [repository];
      const missing = repositories.filter(
        (candidate) => !input.projectsByRepository.has(candidate.toLowerCase()),
      );
      if (missing.length > 0) {
        return yield* Effect.fail(
          `No T3 Code project for ${missing.join(", ")} on this machine. Add the project, then relabel the issue.`,
        );
      }
      const members = [];
      for (const candidate of repositories) {
        const project = input.projectsByRepository.get(candidate.toLowerCase())!;
        members.push({
          projectId: project.id,
          baseBranch: block?.base ?? (yield* github.defaultBranch(candidate)),
        });
      }
      yield* folders.create({
        name: (block?.name ?? `${issue.number} ${issue.title}`).slice(0, 120),
        ...(block?.branch ? { branch: block.branch } : {}),
        members,
        issue: `${repository}#${issue.number}`,
        initialPrompt:
          block?.prompt ??
          `Work on ${issue.url}. Read .context/issue.md first, then write a plan to .context/plan.md before changing code.`,
      });
      yield* github.ensureLabel(repository, `${label}:active`, "1d76db");
      yield* github.editLabels(key, { add: [`${label}:active`], remove: [label] });
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const detail = typeof error === "string" ? error : error.message;
          yield* Effect.logWarning(`Could not create a folder for ${input.issue.url}: ${detail}`);
          const key = { repository: input.repository, number: input.issue.number };
          yield* github
            .comment(key, `T3 Code could not create a folder for this issue: ${detail}`)
            .pipe(
              Effect.andThen(
                github.ensureLabel(input.repository, `${input.label}:error`, "d93f0b"),
              ),
              Effect.andThen(
                github.editLabels(key, { add: [`${input.label}:error`], remove: [input.label] }),
              ),
              Effect.catch(() => Effect.sync(() => skipped.add(issueKeyOf(key)))),
            );
        }),
      ),
    );

  /** Move linked issues forward as the folder's pull requests open and merge. */
  const advanceStatus = (folder: Folder, repositoryByProject: ReadonlyMap<string, string>) =>
    Effect.gen(function* () {
      const issue = folder.issue;
      if (!issue || folder.archivedAt !== null || issue.status === "done") return;
      const states: string[] = [];
      for (const member of folder.members) {
        const repository = repositoryByProject.get(member.projectId);
        if (!repository) continue;
        states.push(...(yield* github.pullRequestStates(repository, member.branch)));
      }
      const next = nextAutomaticStatus(issue.status, states);
      if (next !== null) yield* folders.setIssueStatus({ slug: folder.slug, status: next });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(`Could not update the issue status for folder ${folder.slug}`, error),
      ),
    );

  return Effect.gen(function* () {
    const current = yield* settings.getSettings;
    if (!current.githubIssueFolders) return;
    const label = current.githubIssueFolderLabel;
    const snapshot = yield* snapshotQuery.getShellSnapshot();
    const projectsByRepository = new Map<string, OrchestrationProjectShell>();
    const repositoryByProject = new Map<string, string>();
    for (const project of snapshot.projects) {
      const repository = githubRepository(project);
      if (repository === null) continue;
      projectsByRepository.set(repository.toLowerCase(), project);
      repositoryByProject.set(project.id, repository);
    }
    const listed = yield* folders.list();
    const linked = new Set(
      listed.folders.flatMap((folder) => (folder.issue ? [issueKeyOf(folder.issue)] : [])),
    );

    for (const [key, project] of projectsByRepository) {
      const repository = repositoryByProject.get(project.id) ?? key;
      const issues = yield* github
        .listLabeledIssues(repository, label)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning(`Could not list ${label} issues in ${repository}`, error).pipe(
              Effect.as([] as ReadonlyArray<FolderGitHub.LabeledIssue>),
            ),
          ),
        );
      for (const issue of issues) {
        const issueKey = issueKeyOf({ repository, number: issue.number });
        if (linked.has(issueKey) || skipped.has(issueKey)) continue;
        yield* startFolder({ repository, issue, label, projectsByRepository });
        linked.add(issueKey);
      }
    }

    for (const folder of listed.folders) {
      yield* advanceStatus(folder, repositoryByProject);
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("GitHub issue folder sync failed", cause)),
  );
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const syncOnce = yield* makeSyncOnce;
    yield* syncOnce.pipe(
      Effect.delay("30 seconds"),
      Effect.repeat(Schedule.spaced(POLL_INTERVAL)),
      Effect.forkScoped,
    );
  }),
);
