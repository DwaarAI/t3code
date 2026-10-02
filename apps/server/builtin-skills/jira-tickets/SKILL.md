---
name: jira-tickets
description: Use the Jira tickets attached to this T3 Code folder as the source of requirements, acceptance criteria and test cases. Use when planning, implementing, testing or reviewing work in a folder, or when the user mentions a Jira ticket key such as DW-123.
---

# Jira tickets

A T3 Code folder can have Jira tickets attached to it. They describe what the folder's work is for. Read them before you plan, build, test or review, and treat them as the requirements unless the user tells you otherwise.

## Reading the tickets

Use the Jira tools from the `t3-code` MCP server:

- `list_folder_jira_tickets` lists the tickets attached to this thread's folder, with status, type and assignee.
- `get_jira_ticket` reads one ticket: its description and comments as Markdown, labels, its sub-tasks and child issues, and the statuses it can move to now.
- `search_jira_tickets` finds other tickets by key, free text or JQL, for example `project = DW AND status != Done`.

Start with `list_folder_jira_tickets`, then call `get_jira_ticket` for each ticket that matters to the task, and for its sub-tickets when the parent's description defers to them. Comments often hold decisions made after the description was written, so read them too. When the user names a ticket key, read that ticket even when it is not attached to the folder.

If the tools are not available, the Jira connection is missing or failing: say so and ask the user to connect Jira in T3 Code's Settings, rather than guessing what the ticket says.

## Using them

- **Planning:** turn the description and acceptance criteria into the plan's steps, name which ticket or sub-ticket each step covers, and list open questions the tickets leave unanswered. In a folder, plans are saved to `.context/plans/`.
- **Implementing:** keep to the ticket's scope. When the code or the user's instructions disagree with the ticket, point it out instead of silently choosing one.
- **Testing:** derive test cases from the acceptance criteria and from bugs described in comments, and report which criteria were checked and how.
- **Reviewing:** check the change against the ticket's requirements as well as for bugs.

Quote ticket keys (for example `DW-123`) in plans, commit messages and pull request descriptions so the work links back to Jira.

## Writing to Jira

`comment_on_jira_ticket` posts a Markdown comment, and `change_jira_ticket_status` moves a ticket to another status such as In Review. Both are visible to the whole team, so use them only when the user asks, or when the user asked you to report progress on the ticket. Never change a ticket's description or close it on your own initiative.
