import {
  JiraComment,
  JiraIssueDetail,
  JiraIssueKey,
  JiraIssueSummary,
  McpCapabilityUnavailableError,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as ServerConfig from "../../../config.ts";
import * as FolderService from "../../../folder/FolderService.ts";
import * as JiraService from "../../../jira/JiraService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  FolderService.FolderService,
  JiraService.JiraService,
  ServerConfig.ServerConfig,
];

/** Any Jira failure, with Jira's own explanation as the message. */
export class JiraToolError extends Schema.TaggedError<JiraToolError>()("JiraToolError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const JiraToolFailure = Schema.Union([JiraToolError, McpCapabilityUnavailableError]);

const KeyInput = Schema.Struct({
  key: JiraIssueKey.annotate({ description: "Ticket key, for example DW-123." }),
});

export const FolderJiraTicketsResult = Schema.Struct({
  folder: Schema.NullOr(Schema.String).annotate({
    description: "The folder this thread works in, or null outside a folder.",
  }),
  tickets: Schema.Array(JiraIssueSummary),
});
export type FolderJiraTicketsResult = typeof FolderJiraTicketsResult.Type;

const ListFolderTicketsTool = Tool.make("list_folder_jira_tickets", {
  description:
    "List the Jira tickets attached to this thread's T3 Code folder, with status, type and assignee. Call get_jira_ticket for a ticket's description, sub-tickets and comments.",
  success: FolderJiraTicketsResult,
  failure: JiraToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "List folder Jira tickets")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const GetTicketTool = Tool.make("get_jira_ticket", {
  description:
    "Read a Jira ticket: description and comments as Markdown, labels, sub-tasks and child issues, and the status changes available now.",
  parameters: KeyInput,
  success: JiraIssueDetail,
  failure: JiraToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Read Jira ticket")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const SearchTicketsTool = Tool.make("search_jira_tickets", {
  description:
    "Search Jira by ticket key, free text, or JQL (for example `project = DW AND status != Done`). Returns up to 25 tickets.",
  parameters: Schema.Struct({ query: TrimmedNonEmptyString }),
  success: Schema.Struct({ tickets: Schema.Array(JiraIssueSummary) }),
  failure: JiraToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Search Jira")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const CommentTool = Tool.make("comment_on_jira_ticket", {
  description:
    "Post a comment on a Jira ticket, written in Markdown. Only comment when the user asked you to, or to report finished work they asked you to report.",
  parameters: Schema.Struct({
    key: KeyInput.fields.key,
    body: TrimmedNonEmptyString.annotate({ description: "Comment text in Markdown." }),
  }),
  success: JiraComment,
  failure: JiraToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Comment on Jira ticket")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ChangeStatusTool = Tool.make("change_jira_ticket_status", {
  description:
    "Move a Jira ticket to another status, such as In Review. Only change status when the user asked you to. get_jira_ticket lists the statuses it can move to now.",
  parameters: Schema.Struct({
    key: KeyInput.fields.key,
    status: TrimmedNonEmptyString.annotate({
      description: "Target status or transition name, matched case-insensitively.",
    }),
  }),
  success: JiraIssueDetail,
  failure: JiraToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Change Jira ticket status")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const JiraToolkit = Toolkit.make(
  ListFolderTicketsTool,
  GetTicketTool,
  SearchTicketsTool,
  CommentTool,
  ChangeStatusTool,
);
