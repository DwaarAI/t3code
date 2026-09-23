/**
 * FolderGitHub - The `gh` calls folders make: reading an issue with its
 * parent, commenting, applying status labels, and the lookups the issue sync
 * needs. Uses the server's GitHub CLI login.
 */
import { FolderError, type FolderIssueRef, type FolderIssueStatus } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { type IssueKey, STATUS_LABEL_COLORS, STATUS_LABELS } from "./githubIssues.ts";

export interface FetchedIssue {
  readonly ref: FolderIssueRef;
  readonly body: string;
  readonly author: string | null;
  readonly parent: FolderIssueRef | undefined;
}

export interface LabeledIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly body: string;
  readonly author: string | null;
}

export class FolderGitHub extends Context.Service<
  FolderGitHub,
  {
    readonly fetchIssue: (issue: IssueKey) => Effect.Effect<FetchedIssue, FolderError>;
    readonly comment: (issue: IssueKey, body: string) => Effect.Effect<void, FolderError>;
    readonly setStatus: (
      issue: IssueKey,
      status: FolderIssueStatus,
    ) => Effect.Effect<void, FolderError>;
    readonly editLabels: (
      issue: IssueKey,
      change: { readonly add: ReadonlyArray<string>; readonly remove: ReadonlyArray<string> },
    ) => Effect.Effect<void, FolderError>;
    readonly listLabeledIssues: (
      repository: string,
      label: string,
    ) => Effect.Effect<ReadonlyArray<LabeledIssue>, FolderError>;
    /** Whether `login` may push to the repository, the bar for acting on their issue. */
    readonly canWrite: (repository: string, login: string) => Effect.Effect<boolean, FolderError>;
    readonly pullRequestStates: (
      repository: string,
      branch: string,
    ) => Effect.Effect<ReadonlyArray<string>, FolderError>;
    readonly defaultBranch: (repository: string) => Effect.Effect<string, FolderError>;
    /** Create or update a label so it can be added to issues. */
    readonly ensureLabel: (
      repository: string,
      label: string,
      color: string,
    ) => Effect.Effect<void, FolderError>;
  }
>()("t3/folder/FolderGitHub") {}

const IssueRefJson = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  repository: Schema.optional(Schema.Struct({ nameWithOwner: Schema.String })),
});

const IssueQueryJson = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      issue: Schema.Struct({
        number: Schema.Number,
        title: Schema.String,
        url: Schema.String,
        body: Schema.String,
        author: Schema.NullOr(Schema.Struct({ login: Schema.String })),
        parent: Schema.optional(Schema.NullOr(IssueRefJson)),
      }),
    }),
  }),
});

const LabeledIssuesJson = Schema.Array(
  Schema.Struct({
    number: Schema.Number,
    title: Schema.String,
    url: Schema.String,
    body: Schema.String,
    author: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  }),
);

const PullRequestStatesJson = Schema.Array(Schema.Struct({ state: Schema.String }));

const decodeJson = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema));

const ISSUE_FIELDS = "number title url body author { login }";

function issueQuery(withParent: boolean): string {
  const parent = withParent ? " parent { number title url repository { nameWithOwner } }" : "";
  return `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { ${ISSUE_FIELDS}${parent} } } }`;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const gh = yield* GitHubCli.GitHubCli;
  const serverConfig = yield* ServerConfig.ServerConfig;
  // `gh` addresses repositories with --repo, so any directory works as cwd.
  const cwd = serverConfig.baseDir;
  const labelledRepositories = new Set<string>();

  const run = (detail: string, args: ReadonlyArray<string>, stdin?: string) =>
    gh.execute({ cwd, args, ...(stdin === undefined ? {} : { stdin }) }).pipe(
      Effect.map((output) => output.stdout),
      Effect.mapError(
        (cause) =>
          new FolderError({
            reason: "github_failed",
            detail: `${detail}: ${cause.message}`,
            cause,
          }),
      ),
    );

  const decoded = <A>(detail: string, effect: Effect.Effect<A, Schema.SchemaError>) =>
    effect.pipe(
      Effect.mapError(
        (cause) =>
          new FolderError({
            reason: "github_failed",
            detail: `${detail}: ${cause.message}`,
            cause,
          }),
      ),
    );

  const fetchIssue: FolderGitHub["Service"]["fetchIssue"] = (issue) =>
    Effect.gen(function* () {
      const [owner, name] = issue.repository.split("/");
      const query = (withParent: boolean) =>
        run(`Could not read ${issue.repository}#${issue.number}`, [
          "api",
          "graphql",
          "-f",
          `query=${issueQuery(withParent)}`,
          "-F",
          `owner=${owner}`,
          "-F",
          `name=${name}`,
          "-F",
          `number=${issue.number}`,
        ]);
      // Hosts without sub-issues reject the parent field; ask again without it.
      const raw = yield* query(true).pipe(Effect.catch(() => query(false)));
      const parsed = yield* decoded(
        `Unexpected issue response for ${issue.repository}#${issue.number}`,
        decodeJson(IssueQueryJson)(raw),
      );
      const found = parsed.data.repository.issue;
      const parent = found.parent;
      return {
        ref: {
          repository: issue.repository,
          number: found.number,
          url: found.url,
          title: found.title,
        },
        body: found.body,
        author: found.author?.login ?? null,
        parent: parent
          ? {
              repository: parent.repository?.nameWithOwner ?? issue.repository,
              number: parent.number,
              url: parent.url,
              title: parent.title,
            }
          : undefined,
      };
    });

  const comment: FolderGitHub["Service"]["comment"] = (issue, body) =>
    run(
      `Could not comment on ${issue.repository}#${issue.number}`,
      ["issue", "comment", String(issue.number), "--repo", issue.repository, "--body-file", "-"],
      body,
    ).pipe(Effect.asVoid);

  /** Status labels must exist before `gh issue edit` can add them. */
  const ensureStatusLabels = (repository: string) =>
    Effect.gen(function* () {
      if (labelledRepositories.has(repository)) return;
      for (const [status, label] of Object.entries(STATUS_LABELS)) {
        yield* run(`Could not create label ${label} in ${repository}`, [
          "label",
          "create",
          label,
          "--repo",
          repository,
          "--color",
          STATUS_LABEL_COLORS[status as FolderIssueStatus],
          "--force",
        ]);
      }
      labelledRepositories.add(repository);
    });

  const editLabels: FolderGitHub["Service"]["editLabels"] = (issue, change) =>
    run(`Could not update labels on ${issue.repository}#${issue.number}`, [
      "issue",
      "edit",
      String(issue.number),
      "--repo",
      issue.repository,
      ...change.add.flatMap((label) => ["--add-label", label]),
      ...change.remove.flatMap((label) => ["--remove-label", label]),
    ]).pipe(Effect.asVoid);

  const setStatus: FolderGitHub["Service"]["setStatus"] = (issue, status) =>
    ensureStatusLabels(issue.repository).pipe(
      Effect.andThen(
        editLabels(issue, {
          add: [STATUS_LABELS[status]],
          remove: Object.values(STATUS_LABELS).filter((label) => label !== STATUS_LABELS[status]),
        }),
      ),
    );

  const listLabeledIssues: FolderGitHub["Service"]["listLabeledIssues"] = (repository, label) =>
    run(`Could not list issues in ${repository}`, [
      "issue",
      "list",
      "--repo",
      repository,
      "--label",
      label,
      "--state",
      "open",
      "--limit",
      "30",
      "--json",
      "number,title,url,body,author",
    ]).pipe(
      Effect.flatMap((raw) =>
        decoded(`Unexpected issue list for ${repository}`, decodeJson(LabeledIssuesJson)(raw)),
      ),
      Effect.map((issues) =>
        issues.map((issue) => ({ ...issue, author: issue.author?.login ?? null })),
      ),
    );

  const canWrite: FolderGitHub["Service"]["canWrite"] = (repository, login) =>
    run(`Could not read ${login}'s access to ${repository}`, [
      "api",
      `repos/${repository}/collaborators/${login}/permission`,
      "--jq",
      ".permission",
    ]).pipe(Effect.map((permission) => ["admin", "maintain", "write"].includes(permission.trim())));

  const pullRequestStates: FolderGitHub["Service"]["pullRequestStates"] = (repository, branch) =>
    run(`Could not list pull requests for ${branch} in ${repository}`, [
      "pr",
      "list",
      "--repo",
      repository,
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "20",
      "--json",
      "state",
    ]).pipe(
      Effect.flatMap((raw) =>
        decoded(
          `Unexpected pull request list for ${repository}`,
          decodeJson(PullRequestStatesJson)(raw),
        ),
      ),
      Effect.map((pullRequests) => pullRequests.map((pullRequest) => pullRequest.state)),
    );

  const defaultBranch: FolderGitHub["Service"]["defaultBranch"] = (repository) =>
    run(`Could not read the default branch of ${repository}`, [
      "repo",
      "view",
      repository,
      "--json",
      "defaultBranchRef",
      "--jq",
      ".defaultBranchRef.name",
    ]).pipe(Effect.map((name) => name.trim() || "main"));

  const ensureLabel: FolderGitHub["Service"]["ensureLabel"] = (repository, label, color) =>
    run(`Could not create label ${label} in ${repository}`, [
      "label",
      "create",
      label,
      "--repo",
      repository,
      "--color",
      color,
      "--force",
    ]).pipe(Effect.asVoid);

  return FolderGitHub.of({
    defaultBranch,
    ensureLabel,
    fetchIssue,
    comment,
    setStatus,
    editLabels,
    listLabeledIssues,
    canWrite,
    pullRequestStates,
  });
});

export const layer = Layer.effect(FolderGitHub, make);
