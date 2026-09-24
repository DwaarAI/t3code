import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * A folder groups the worktrees of one feature across repositories. It is a
 * directory under `<T3 home>/folders/<slug>/` holding `folder.json`, a shared
 * `.context/` directory, and one worktree per member repository. Threads join
 * a folder by running in one of its member worktrees; they carry no folder id.
 */
export const FolderSlug = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/),
);
export type FolderSlug = typeof FolderSlug.Type;

/** What happened when a member's worktree was prepared. */
export const FolderMemberSetup = Schema.Struct({
  /** What a new branch started from, such as `origin/main@1a2b3c4`; null for an existing branch. */
  baseRef: Schema.NullOr(Schema.String),
  /** Gitignored `.env*` files copied from the project's checkout, relative to its root. */
  envFiles: Schema.Array(Schema.String),
  at: IsoDateTime,
});
export type FolderMemberSetup = typeof FolderMemberSetup.Type;

export const FolderMember = Schema.Struct({
  projectId: ProjectId,
  /** Directory name of the worktree inside the folder. Unique per folder. */
  repoName: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  /** Set while the worktree is removed from disk; its branch is kept. */
  archivedAt: Schema.NullOr(IsoDateTime),
  setup: Schema.optional(FolderMemberSetup),
});
export type FolderMember = typeof FolderMember.Type;

export const FolderIssueStatus = Schema.Literals(["in-progress", "in-review", "done"]);
export type FolderIssueStatus = typeof FolderIssueStatus.Type;

export const FolderIssueRef = Schema.Struct({
  /** `owner/name` on GitHub. */
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  url: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
});
export type FolderIssueRef = typeof FolderIssueRef.Type;

/** The GitHub issue a folder works on, with its parent when it is a sub-issue. */
export const FolderIssue = Schema.Struct({
  ...FolderIssueRef.fields,
  parent: Schema.optional(FolderIssueRef),
  /** The status label T3 Code last applied; null before any. */
  status: Schema.NullOr(FolderIssueStatus).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type FolderIssue = typeof FolderIssue.Type;

/** The `folder.json` file. Paths are derived, so moving T3 home keeps working. */
export const FolderManifest = Schema.Struct({
  version: Schema.Literal(1),
  slug: FolderSlug,
  name: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  members: Schema.Array(FolderMember),
  issue: Schema.optional(FolderIssue),
  /** Suggested first message for a worktree's first thread. */
  initialPrompt: Schema.optional(Schema.String),
});
export type FolderManifest = typeof FolderManifest.Type;

export const Folder = Schema.Struct({
  ...FolderManifest.fields,
  path: TrimmedNonEmptyString,
  contextDir: TrimmedNonEmptyString,
});
export type Folder = typeof Folder.Type;

export const FoldersListInput = Schema.Struct({});
export type FoldersListInput = typeof FoldersListInput.Type;

export const FoldersListResult = Schema.Struct({
  foldersDir: TrimmedNonEmptyString,
  /** Reusable guideline files any thread can attach. */
  guidesDir: TrimmedNonEmptyString,
  folders: Schema.Array(Folder),
});
export type FoldersListResult = typeof FoldersListResult.Type;

export const FolderMemberInput = Schema.Struct({
  projectId: ProjectId,
  baseBranch: TrimmedNonEmptyString,
});
export type FolderMemberInput = typeof FolderMemberInput.Type;

export const FolderCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  /** Branch created in every member repository. Defaults to `feat/<slug>`. */
  branch: Schema.optional(TrimmedNonEmptyString),
  members: Schema.Array(FolderMemberInput).check(Schema.isNonEmpty()),
  /** A GitHub issue URL or `owner/name#number` to link and comment on. */
  issue: Schema.optional(TrimmedNonEmptyString),
  initialPrompt: Schema.optional(Schema.String),
});
export type FolderCreateInput = typeof FolderCreateInput.Type;

export const FolderResult = Schema.Struct({ folder: Folder });
export type FolderResult = typeof FolderResult.Type;

export const FolderAddMemberInput = Schema.Struct({
  slug: FolderSlug,
  member: FolderMemberInput,
});
export type FolderAddMemberInput = typeof FolderAddMemberInput.Type;

export const FolderMemberRefInput = Schema.Struct({
  slug: FolderSlug,
  projectId: ProjectId,
  /** Remove the worktree even when it has uncommitted changes. */
  force: Schema.optional(Schema.Boolean),
});
export type FolderMemberRefInput = typeof FolderMemberRefInput.Type;

export const FolderRefInput = Schema.Struct({
  slug: FolderSlug,
  force: Schema.optional(Schema.Boolean),
});
export type FolderRefInput = typeof FolderRefInput.Type;

export const FolderDeleteResult = Schema.Struct({ slug: FolderSlug });
export type FolderDeleteResult = typeof FolderDeleteResult.Type;

export const FolderSetIssueStatusInput = Schema.Struct({
  slug: FolderSlug,
  status: FolderIssueStatus,
});
export type FolderSetIssueStatusInput = typeof FolderSetIssueStatusInput.Type;

export const FolderHandoffInput = Schema.Struct({ threadId: ThreadId });
export type FolderHandoffInput = typeof FolderHandoffInput.Type;

export const FolderHandoffResult = Schema.Struct({
  /** Absolute path of the written handoff note. */
  path: TrimmedNonEmptyString,
});
export type FolderHandoffResult = typeof FolderHandoffResult.Type;

export const FolderErrorReason = Schema.Literals([
  "not_found",
  "already_exists",
  "invalid_input",
  "project_not_found",
  "not_in_folder",
  "dirty_worktree",
  "git_failed",
  "io_failed",
  "github_failed",
]);
export type FolderErrorReason = typeof FolderErrorReason.Type;

export class FolderError extends Schema.TaggedError<FolderError>()("FolderError", {
  reason: FolderErrorReason,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
