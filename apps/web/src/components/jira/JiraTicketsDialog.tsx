/**
 * A folder's Jira tickets: the attached list, a search to attach more, and the
 * selected ticket with its sub-tickets, editable fields, status and comments.
 * Opened from the sidebar; every read goes through the environment's Jira login.
 */
import {
  folderTicketsQuery,
  jiraStatusTone,
  orderFolderTickets,
} from "@t3tools/client-runtime/state/jira";
import type {
  EnvironmentId,
  Folder,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraStatusCategory,
} from "@t3tools/contracts";
import { ChevronDownIcon, ExternalLinkIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { create } from "zustand";

import { cn } from "~/lib/utils";
import { folderEnvironment, useFoldersForEnvironment } from "~/state/folders";
import { jiraEnvironment } from "~/state/jira";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const NO_KEYS: ReadonlyArray<string> = [];

interface Request {
  readonly environmentId: EnvironmentId;
  readonly slug: string;
}
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

export function openJiraTicketsDialog(environmentId: EnvironmentId, folder: Folder) {
  useRequest.setState({ request: { environmentId, slug: folder.slug } });
}

function close() {
  useRequest.setState({ request: null });
}

export function JiraTicketsDialogHost() {
  const request = useRequest((state) => state.request);
  useEffect(() => () => close(), []);
  return request ? <JiraTicketsDialog {...request} /> : null;
}

const STATUS_TONE_CLASSES: Record<ReturnType<typeof jiraStatusTone>, string> = {
  neutral: "bg-muted text-muted-foreground",
  progress: "bg-info/15 text-info",
  done: "bg-success/15 text-success",
};

function StatusPill({ status, category }: { status: string; category: JiraStatusCategory }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[0.7rem] font-medium uppercase tracking-wide",
        STATUS_TONE_CLASSES[jiraStatusTone(category)],
      )}
    >
      {status}
    </span>
  );
}

function TicketRow(props: {
  issue: JiraIssueSummary;
  selected?: boolean;
  onSelect: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/ticket flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50",
        props.selected && "bg-accent",
      )}
    >
      <button type="button" onClick={props.onSelect} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {props.issue.key}
          </span>
          <StatusPill status={props.issue.status} category={props.issue.statusCategory} />
        </span>
        <span className="mt-0.5 block truncate text-sm">{props.issue.summary}</span>
      </button>
      {props.action}
    </div>
  );
}

function JiraTicketsDialog({ environmentId, slug }: Request) {
  const folder = useFoldersForEnvironment(environmentId)?.folders.find(
    (entry) => entry.slug === slug,
  );
  const keys = folder?.jiraIssues ?? NO_KEYS;
  const query = folderTicketsQuery(keys);
  const attached = useEnvironmentQuery(
    query === null ? null : jiraEnvironment.search({ environmentId, input: { query } }),
  );
  const tickets = useMemo(
    () => orderFolderTickets(keys, attached.data?.issues ?? []),
    [attached.data, keys],
  );
  const [selected, setSelected] = useState<string | null>(keys[0] ?? null);
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const results = useEnvironmentQuery(
    submitted === ""
      ? null
      : jiraEnvironment.search({ environmentId, input: { query: submitted } }),
  );
  const attach = useAtomCommand(folderEnvironment.attachJiraIssue);
  const detach = useAtomCommand(folderEnvironment.detachJiraIssue);
  const status = useEnvironmentQuery(jiraEnvironment.status({ environmentId, input: {} }));

  const attachKey = async (key: string) => {
    const result = await attach({ environmentId, input: { slug, key } });
    if (result._tag === "Success") {
      attached.refresh();
      setSelected(key);
    }
  };
  const detachKey = async (key: string) => {
    const result = await detach({ environmentId, input: { slug, key } });
    if (result._tag === "Success" && selected === key) setSelected(null);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="h-[min(85vh,52rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Jira tickets{folder ? ` · ${folder.name}` : ""}</DialogTitle>
        </DialogHeader>
        {status.data && !status.data.configured ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            Connect Jira in Settings → Source control first. Tickets are read with the server's Jira
            login.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col border-t sm:flex-row">
            <div className="flex min-h-0 flex-col border-b sm:w-80 sm:shrink-0 sm:border-r sm:border-b-0">
              <form
                className="flex gap-1.5 p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSubmitted(search.trim());
                }}
              >
                <Input
                  size="sm"
                  value={search}
                  placeholder="Attach: key, text, or JQL"
                  aria-label="Search Jira"
                  onChange={(event) => {
                    setSearch(event.target.value);
                    if (event.target.value.trim() === "") setSubmitted("");
                  }}
                />
                <Button type="submit" size="sm" variant="outline" disabled={!search.trim()}>
                  Search
                </Button>
              </form>
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-0.5 px-2 pb-2">
                  {submitted !== "" ? (
                    <>
                      <p className="px-2 pt-1 text-xs text-muted-foreground">
                        {results.isPending && !results.data
                          ? "Searching…"
                          : (results.error ?? `${results.data?.issues.length ?? 0} results`)}
                      </p>
                      {(results.data?.issues ?? []).map((issue) => (
                        <TicketRow
                          key={issue.key}
                          issue={issue}
                          selected={selected === issue.key}
                          onSelect={() => setSelected(issue.key)}
                          action={
                            keys.includes(issue.key) ? (
                              <span className="text-xs text-muted-foreground">Attached</span>
                            ) : (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => void attachKey(issue.key)}
                              >
                                <PlusIcon />
                                Attach
                              </Button>
                            )
                          }
                        />
                      ))}
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setSearch("");
                          setSubmitted("");
                        }}
                      >
                        Clear search
                      </Button>
                    </>
                  ) : keys.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      No tickets attached yet. Search above to attach one; its sub-tickets come with
                      it.
                    </p>
                  ) : (
                    <>
                      {attached.error ? (
                        <p className="px-2 py-1 text-xs text-destructive-foreground">
                          {attached.error}
                        </p>
                      ) : null}
                      {tickets.map((issue) => (
                        <TicketRow
                          key={issue.key}
                          issue={issue}
                          selected={selected === issue.key}
                          onSelect={() => setSelected(issue.key)}
                          action={
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label={`Detach ${issue.key}`}
                                    onClick={() => void detachKey(issue.key)}
                                  />
                                }
                              >
                                <XIcon />
                              </TooltipTrigger>
                              <TooltipPopup side="top">Detach from folder</TooltipPopup>
                            </Tooltip>
                          }
                        />
                      ))}
                    </>
                  )}
                </div>
              </ScrollArea>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {selected ? (
                <TicketDetail
                  key={selected}
                  environmentId={environmentId}
                  issueKey={selected}
                  attached={keys.includes(selected)}
                  onSelect={setSelected}
                  onAttach={() => void attachKey(selected)}
                />
              ) : (
                <p className="m-auto p-6 text-sm text-muted-foreground">
                  Select a ticket to read and edit it.
                </p>
              )}
            </div>
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function TicketDetail(props: {
  environmentId: EnvironmentId;
  issueKey: string;
  attached: boolean;
  onSelect: (key: string) => void;
  onAttach: () => void;
}) {
  const { environmentId, issueKey } = props;
  const query = useEnvironmentQuery(
    jiraEnvironment.issue({ environmentId, input: { key: issueKey } }),
  );
  const issue = query.data;
  if (!issue) {
    return (
      <p className="m-auto p-6 text-sm text-muted-foreground">
        {query.error ?? `Loading ${issueKey}…`}
      </p>
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 p-4">
        <TicketHeader
          issue={issue}
          environmentId={environmentId}
          attached={props.attached}
          onAttach={props.onAttach}
        />
        <TicketDescription issue={issue} environmentId={environmentId} />
        {issue.children.length > 0 ? (
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Sub-tickets
            </h3>
            {issue.children.map((child) => (
              <TicketRow key={child.key} issue={child} onSelect={() => props.onSelect(child.key)} />
            ))}
          </section>
        ) : null}
        <TicketComments issue={issue} environmentId={environmentId} />
      </div>
    </ScrollArea>
  );
}

function TicketHeader(props: {
  issue: JiraIssueDetail;
  environmentId: EnvironmentId;
  attached: boolean;
  onAttach: () => void;
}) {
  const { issue, environmentId } = props;
  const id = useId();
  const update = useAtomCommand(jiraEnvironment.updateIssue);
  const transition = useAtomCommand(jiraEnvironment.transition);
  const [summary, setSummary] = useState(issue.summary);
  const [labels, setLabels] = useState(issue.labels.join(", "));
  const [saving, setSaving] = useState(false);
  const nextLabels = labels
    .split(",")
    .map((label) => label.trim().replaceAll(/\s+/g, "-"))
    .filter(Boolean);
  const changed =
    summary.trim() !== issue.summary || nextLabels.join(",") !== issue.labels.join(",");

  const save = async () => {
    setSaving(true);
    const result = await update({
      environmentId,
      input: {
        key: issue.key,
        ...(summary.trim() !== issue.summary && summary.trim() ? { summary: summary.trim() } : {}),
        labels: nextLabels,
      },
    });
    setSaving(false);
    if (result._tag === "Success")
      toastManager.add({ type: "success", title: `Saved ${issue.key}` });
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground"
        >
          {issue.key}
          <ExternalLinkIcon className="size-3" />
        </a>
        <span className="text-muted-foreground">· {issue.issueType}</span>
        {issue.priority ? <span className="text-muted-foreground">· {issue.priority}</span> : null}
        {issue.parentKey ? (
          <span className="text-muted-foreground">· parent {issue.parentKey}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {props.attached ? null : (
            <Button size="xs" variant="outline" onClick={props.onAttach}>
              <PlusIcon />
              Attach to folder
            </Button>
          )}
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" aria-label="Change status" />}>
              {issue.status}
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {issue.transitions.length === 0 ? (
                <MenuItem disabled>No status changes available</MenuItem>
              ) : (
                issue.transitions.map((entry) => (
                  <MenuItem
                    key={entry.id}
                    onClick={() =>
                      void transition({
                        environmentId,
                        input: { key: issue.key, transitionId: entry.id },
                      })
                    }
                  >
                    {entry.name === entry.toStatus
                      ? entry.name
                      : `${entry.name} → ${entry.toStatus}`}
                  </MenuItem>
                ))
              )}
            </MenuPopup>
          </Menu>
        </span>
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          id={`${id}-summary`}
          aria-label="Summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            aria-label="Labels"
            placeholder="Labels, comma separated"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!changed || !summary.trim() || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
      <p className="text-xs text-muted-foreground">
        {issue.assignee ? `Assigned to ${issue.assignee.displayName}` : "Unassigned"}
        {issue.reporter ? ` · reported by ${issue.reporter.displayName}` : ""}
        {issue.updated ? ` · updated ${formatRelativeTimeLabel(issue.updated)}` : ""}
      </p>
    </section>
  );
}

function TicketDescription(props: { issue: JiraIssueDetail; environmentId: EnvironmentId }) {
  const { issue, environmentId } = props;
  const update = useAtomCommand(jiraEnvironment.updateIssue);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    const result = await update({ environmentId, input: { key: issue.key, description: draft } });
    setSaving(false);
    if (result._tag === "Success") setDraft(null);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Description
        </h3>
        {draft === null ? (
          <Button size="xs" variant="ghost" onClick={() => setDraft(issue.description)}>
            Edit
          </Button>
        ) : null}
      </div>
      {draft === null ? (
        issue.description ? (
          <ChatMarkdown text={issue.description} cwd={undefined} environmentId={environmentId} />
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )
      ) : (
        <>
          <Textarea
            aria-label="Description"
            value={draft}
            rows={12}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Markdown. Headings, lists, quotes, code, bold, italic and links are kept; other Jira
            formatting such as tables, panels and attachments is replaced when you save.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save description"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function TicketComments(props: { issue: JiraIssueDetail; environmentId: EnvironmentId }) {
  const { issue, environmentId } = props;
  const addComment = useAtomCommand(jiraEnvironment.addComment);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const post = async () => {
    setPosting(true);
    const result = await addComment({
      environmentId,
      input: { key: issue.key, body: body.trim() },
    });
    setPosting(false);
    if (result._tag === "Success") setBody("");
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Comments · {issue.comments.length}
      </h3>
      {issue.comments.map((comment) => (
        <article key={comment.id} className="rounded-md border px-3 py-2">
          <p className="mb-1 text-xs text-muted-foreground">
            {comment.author?.displayName ?? "Someone"} · {formatRelativeTimeLabel(comment.created)}
          </p>
          <ChatMarkdown text={comment.body} cwd={undefined} environmentId={environmentId} />
        </article>
      ))}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void post();
        }}
      >
        <Textarea
          aria-label="New comment"
          placeholder="Add a comment (Markdown)"
          value={body}
          rows={3}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim() || posting}>
            {posting ? "Posting…" : "Comment"}
          </Button>
        </div>
      </form>
    </section>
  );
}
