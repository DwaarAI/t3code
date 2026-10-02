import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Jira Cloud tickets, read and edited with the server's Jira login (site URL,
 * account email and API token). Rich text crosses the wire as Markdown; the
 * server converts to and from Jira's document format.
 */
export const JiraIssueKey = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/),
);
export type JiraIssueKey = typeof JiraIssueKey.Type;

export const JiraStatusCategory = Schema.Literals(["new", "indeterminate", "done"]);
export type JiraStatusCategory = typeof JiraStatusCategory.Type;

export const JiraUser = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
});
export type JiraUser = typeof JiraUser.Type;

export const JiraIssueSummary = Schema.Struct({
  key: JiraIssueKey,
  summary: Schema.String,
  status: Schema.String,
  statusCategory: JiraStatusCategory,
  issueType: Schema.String,
  priority: Schema.NullOr(Schema.String),
  assignee: Schema.NullOr(JiraUser),
  parentKey: Schema.NullOr(JiraIssueKey),
  url: Schema.String,
});
export type JiraIssueSummary = typeof JiraIssueSummary.Type;

export const JiraComment = Schema.Struct({
  id: Schema.String,
  author: Schema.NullOr(JiraUser),
  /** Markdown. */
  body: Schema.String,
  created: Schema.String,
  updated: Schema.String,
});
export type JiraComment = typeof JiraComment.Type;

export const JiraTransition = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  toStatus: Schema.String,
});
export type JiraTransition = typeof JiraTransition.Type;

export const JiraIssueDetail = Schema.Struct({
  ...JiraIssueSummary.fields,
  /** Markdown; empty when the ticket has no description. */
  description: Schema.String,
  labels: Schema.Array(Schema.String),
  reporter: Schema.NullOr(JiraUser),
  created: Schema.String,
  updated: Schema.String,
  /** Sub-tasks and child issues. */
  children: Schema.Array(JiraIssueSummary),
  comments: Schema.Array(JiraComment),
  /** Status changes the server's Jira login may make now. */
  transitions: Schema.Array(JiraTransition),
});
export type JiraIssueDetail = typeof JiraIssueDetail.Type;

export const JiraStatusInput = Schema.Struct({});
export type JiraStatusInput = typeof JiraStatusInput.Type;

export const JiraConnection = Schema.Struct({
  configured: Schema.Boolean,
  /** Site URL, such as `https://acme.atlassian.net`. */
  baseUrl: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
});
export type JiraConnection = typeof JiraConnection.Type;

export const JiraConfigureInput = Schema.Struct({
  baseUrl: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  /** Omit to keep the stored token. */
  apiToken: Schema.optional(TrimmedNonEmptyString),
});
export type JiraConfigureInput = typeof JiraConfigureInput.Type;

export const JiraSearchInput = Schema.Struct({
  /** A ticket key, free text, or JQL. */
  query: TrimmedNonEmptyString,
});
export type JiraSearchInput = typeof JiraSearchInput.Type;

export const JiraSearchResult = Schema.Struct({
  issues: Schema.Array(JiraIssueSummary),
});
export type JiraSearchResult = typeof JiraSearchResult.Type;

export const JiraIssueRefInput = Schema.Struct({ key: JiraIssueKey });
export type JiraIssueRefInput = typeof JiraIssueRefInput.Type;

export const JiraUpdateIssueInput = Schema.Struct({
  key: JiraIssueKey,
  summary: Schema.optional(TrimmedNonEmptyString),
  /** Markdown. */
  description: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type JiraUpdateIssueInput = typeof JiraUpdateIssueInput.Type;

export const JiraAddCommentInput = Schema.Struct({
  key: JiraIssueKey,
  /** Markdown. */
  body: TrimmedNonEmptyString,
});
export type JiraAddCommentInput = typeof JiraAddCommentInput.Type;

export const JiraTransitionInput = Schema.Struct({
  key: JiraIssueKey,
  transitionId: TrimmedNonEmptyString,
});
export type JiraTransitionInput = typeof JiraTransitionInput.Type;

export const JiraErrorReason = Schema.Literals([
  "not_configured",
  "unauthorized",
  "not_found",
  "invalid_input",
  "request_failed",
]);
export type JiraErrorReason = typeof JiraErrorReason.Type;

export class JiraError extends Schema.TaggedError<JiraError>()("JiraError", {
  reason: JiraErrorReason,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
