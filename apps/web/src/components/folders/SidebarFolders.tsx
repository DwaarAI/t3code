import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, Folder, FolderMember } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  LayersIcon,
  PlusIcon,
  TicketIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { memo } from "react";

import { useStartFolderSession, useStartFolderThread } from "../../hooks/useStartFolderThread";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { m } from "../../i18n/messages";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { useServerConfigs } from "../../state/entities";
import { folderEnvironment, useEnvironmentFolders } from "../../state/folders";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useRetainedValue, useSidebarRowSubscriptionLease } from "../Sidebar.logic";
import { prStatusIndicator } from "../ThreadStatusIndicators";
import { openJiraTicketsDialog } from "../jira/JiraTicketsDialog";
import { openAddRepositoryDialog, openCreateFolderDialog } from "./CreateFolderDialog";
import { folderThreadGroupKey, groupFolderThreads } from "./SidebarFolders.logic";

const ISSUE_STATUSES = ["in-progress", "in-review", "done"] as const;
const ISSUE_STATUS_LABELS: Record<(typeof ISSUE_STATUSES)[number], string> = {
  "in-progress": msg("In progress", { $context: "issue status" }),
  "in-review": msg("In review", { $context: "issue status" }),
  done: msg("Done", { $context: "issue status" }),
};
const ISSUE_STATUS_ACTIONS: Record<(typeof ISSUE_STATUSES)[number], string> = {
  "in-progress": msg("Mark issue in progress"),
  "in-review": msg("Mark issue in review"),
  done: msg("Mark issue done"),
};

const COLLAPSED_FOLDERS_KEY = "t3code:sidebar:collapsed-folders";
const CollapsedFoldersSchema = Schema.Array(Schema.String);
const ARCHIVED_FOLDERS_EXPANDED_KEY = "t3code:sidebar:archived-folders-expanded";

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : m(msg("An error occurred.")),
    }),
  );
}

/** Reports a failed folder mutation; returns whether it succeeded. */
function settled(title: string, result: AtomCommandResult<unknown, unknown>): boolean {
  if (result._tag === "Success") return true;
  if (!isAtomCommandInterrupted(result)) failureToast(title, squashAtomCommandFailure(result));
  return false;
}

/** Desktop shows a native dialog; the web fallback is the browser's. */
async function confirmDiscard(message: string): Promise<boolean> {
  const api = readLocalApi();
  return api ? api.dialogs.confirm(message) : window.confirm(message);
}

function isDirtyWorktreeFailure(result: AtomCommandResult<unknown, unknown>): boolean {
  if (result._tag === "Success") return false;
  const error = squashAtomCommandFailure(result);
  return (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    error.reason === "dirty_worktree"
  );
}

/** The thread or draft on screen, to highlight its worktree or folder session. */
interface ActiveFolderThread {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly worktreePath: string | null;
}

interface FolderEntry {
  readonly environmentId: EnvironmentId;
  readonly folder: Folder;
}

/**
 * Folders above the thread list: each expands into one row per repository
 * worktree. A row opens that worktree's latest thread; its threads show as tabs
 * above the chat.
 */
export const SidebarFolders = memo(function SidebarFolders(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly activeWorktree: ActiveFolderThread | null;
}) {
  const gt = useGT();
  const environments = useEnvironmentFolders();
  const [collapsed, setCollapsed] = useLocalStorage(
    COLLAPSED_FOLDERS_KEY,
    [] as ReadonlyArray<string>,
    CollapsedFoldersSchema,
  );
  const [archivedExpanded, setArchivedExpanded] = useLocalStorage(
    ARCHIVED_FOLDERS_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );

  const live: FolderEntry[] = [];
  const archived: FolderEntry[] = [];
  for (const environment of environments) {
    for (const folder of environment.folders) {
      (folder.archivedAt === null ? live : archived).push({
        environmentId: environment.environmentId,
        folder,
      });
    }
  }
  const threadsByWorktree = groupFolderThreads(props.threads);

  const toggleFolder = (key: string) =>
    setCollapsed((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );

  if (environments.length === 0) return null;

  const renderFolder = ({ environmentId, folder }: FolderEntry) => {
    const key = `${environmentId}:${folder.slug}`;
    return (
      <FolderGroup
        key={key}
        environmentId={environmentId}
        folder={folder}
        expanded={!collapsed.includes(key)}
        onToggle={() => toggleFolder(key)}
        threadsByWorktree={threadsByWorktree}
        activeWorktree={props.activeWorktree}
      />
    );
  };

  return (
    <div className="flex flex-col gap-0.5 px-(--sidebar-content-inset) pb-1">
      <div className="flex h-7 items-center gap-2 px-2 text-sidebar-muted-foreground/70 text-xs">
        <span className="font-medium">
          <T>Folders</T>
        </span>
        <span aria-hidden className="h-px min-w-2 flex-1 bg-sidebar-border/60" />
        <Button
          size="icon-micro"
          variant="ghost"
          aria-label={gt("New folder")}
          onClick={() => openCreateFolderDialog()}
        >
          <FolderPlusIcon />
        </Button>
      </div>
      {live.length === 0 ? (
        <button
          type="button"
          onClick={() => openCreateFolderDialog()}
          className="rounded-lg px-2 py-1 text-left text-sidebar-muted-foreground/70 text-xs hover:bg-sidebar-row-hover"
        >
          <T>Group a feature's worktrees across repositories.</T>
        </button>
      ) : (
        live.map(renderFolder)
      )}
      {archived.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={archivedExpanded}
            onClick={() => setArchivedExpanded((value) => !value)}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-left text-sidebar-muted-foreground/60 text-xs hover:bg-sidebar-row-hover"
          >
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3 shrink-0", archivedExpanded && "rotate-90")}
            />
            <T>
              Archived folders (<Var>{archived.length}</Var>)
            </T>
          </button>
          {archivedExpanded ? archived.map(renderFolder) : null}
        </>
      ) : null}
    </div>
  );
});

function FolderGroup(props: {
  environmentId: EnvironmentId;
  folder: Folder;
  expanded: boolean;
  onToggle: () => void;
  threadsByWorktree: ReadonlyMap<string, ReadonlyArray<EnvironmentThreadShell>>;
  activeWorktree: ActiveFolderThread | null;
}) {
  const { environmentId, folder } = props;
  const gt = useGT();
  const messages = useMessages();
  const archiveFolder = useAtomCommand(folderEnvironment.archive, { reportFailure: false });
  const restoreFolder = useAtomCommand(folderEnvironment.restore, { reportFailure: false });
  const setIssueStatus = useAtomCommand(folderEnvironment.setIssueStatus, {
    reportFailure: false,
  });
  const deleteFolder = useAtomCommand(folderEnvironment.delete, { reportFailure: false });
  const startFolderSession = useStartFolderSession();
  const jiraAvailable =
    useServerConfigs().get(environmentId)?.environment.capabilities.jira === true;
  const jiraCount = folder.jiraIssues?.length ?? 0;
  const issue = folder.issue;
  const openIssue = () => {
    if (!issue) return;
    void readLocalApi()?.shell.openExternal(issue.url);
  };
  const isArchived = folder.archivedAt !== null;

  const remove = async () => {
    const confirmed = await confirmDiscard(
      gt("Delete {name}? Its worktrees and shared .context notes are removed. The branches stay.", {
        name: folder.name,
      }),
    );
    if (!confirmed) return;
    let result = await deleteFolder({ environmentId, input: { slug: folder.slug } });
    if (
      isDirtyWorktreeFailure(result) &&
      (await confirmDiscard(
        gt("Some worktrees in {name} have uncommitted changes. Delete anyway and discard them?", {
          name: folder.name,
        }),
      ))
    ) {
      result = await deleteFolder({ environmentId, input: { slug: folder.slug, force: true } });
    }
    settled(gt("Could not delete the folder"), result);
  };

  const archive = async () => {
    let result = await archiveFolder({ environmentId, input: { slug: folder.slug } });
    if (
      isDirtyWorktreeFailure(result) &&
      (await confirmDiscard(
        gt("Some worktrees in {name} have uncommitted changes. Archive anyway and discard them?", {
          name: folder.name,
        }),
      ))
    ) {
      result = await archiveFolder({ environmentId, input: { slug: folder.slug, force: true } });
    }
    settled(gt("Could not archive the folder"), result);
  };

  return (
    <div className="flex flex-col">
      <div className="group/folder flex h-8 items-center gap-1 rounded-lg pr-1 hover:bg-sidebar-row-hover">
        <button
          type="button"
          aria-expanded={props.expanded}
          onClick={props.onToggle}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-sm",
            isArchived ? "text-sidebar-muted-foreground/60" : "text-sidebar-foreground",
          )}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-sidebar-muted-foreground",
              props.expanded && "rotate-90",
            )}
          />
          <FolderIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
          <span className="truncate font-medium">{folder.name}</span>
          {issue ? (
            <span className="shrink-0 text-sidebar-muted-foreground/70 text-xs tabular-nums">
              #{issue.number}
              {issue.status ? ` · ${messages(ISSUE_STATUS_LABELS[issue.status])}` : ""}
            </span>
          ) : null}
        </button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost"
                aria-label={gt("{name} actions", { name: folder.name })}
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {isArchived ? (
              <>
                <MenuItem
                  onClick={() =>
                    void restoreFolder({ environmentId, input: { slug: folder.slug } }).then(
                      (result) => settled(gt("Could not restore the folder"), result),
                    )
                  }
                >
                  <T>Restore folder</T>
                </MenuItem>
                <MenuSeparator />
                <MenuItem onClick={() => void remove()}>
                  <T>Delete folder…</T>
                </MenuItem>
              </>
            ) : (
              <>
                {issue ? (
                  <>
                    <MenuItem onClick={openIssue}>
                      <T>
                        Open issue <Var>{`${issue.repository}#${issue.number}`}</Var>
                      </T>
                    </MenuItem>
                    {ISSUE_STATUSES.map((status) => (
                      <MenuItem
                        key={status}
                        disabled={issue.status === status}
                        onClick={() =>
                          void setIssueStatus({
                            environmentId,
                            input: { slug: folder.slug, status },
                          }).then((result) => settled(gt("Could not update the issue"), result))
                        }
                      >
                        {messages(ISSUE_STATUS_ACTIONS[status])}
                      </MenuItem>
                    ))}
                    <MenuSeparator />
                  </>
                ) : null}
                <MenuItem onClick={() => void startFolderSession(environmentId, folder)}>
                  <T>New folder session</T>
                </MenuItem>
                {jiraAvailable ? (
                  <MenuItem onClick={() => openJiraTicketsDialog(environmentId, folder)}>
                    <T>Jira tickets…</T>
                  </MenuItem>
                ) : null}
                <MenuItem onClick={() => openAddRepositoryDialog(environmentId, folder)}>
                  <T>Add repository…</T>
                </MenuItem>
                <MenuItem onClick={() => void navigator.clipboard.writeText(folder.contextDir)}>
                  <T>Copy .context path</T>
                </MenuItem>
                <MenuSeparator />
                <MenuItem onClick={() => void archive()}>
                  <T>Archive folder</T>
                </MenuItem>
                <MenuItem onClick={() => void remove()}>
                  <T>Delete folder…</T>
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </Menu>
      </div>
      {props.expanded ? (
        <ul className="ml-4 flex flex-col gap-0.5 border-sidebar-border border-l pl-1.5">
          {isArchived ? null : (
            <FolderSessionRow
              environmentId={environmentId}
              folder={folder}
              threads={
                folder.rootProjectId
                  ? props.threadsByWorktree.get(
                      folderThreadGroupKey({
                        environmentId,
                        projectId: folder.rootProjectId,
                        worktreePath: null,
                      }),
                    )
                  : undefined
              }
              isActive={
                props.activeWorktree?.environmentId === environmentId &&
                props.activeWorktree.worktreePath === null &&
                props.activeWorktree.projectId === folder.rootProjectId
              }
            />
          )}
          {jiraAvailable && jiraCount > 0 ? (
            <li className="flex h-7 items-center rounded-lg pr-1 hover:bg-sidebar-row-hover">
              <button
                type="button"
                onClick={() => openJiraTicketsDialog(environmentId, folder)}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left text-sidebar-foreground text-sm"
              >
                <TicketIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-sidebar-muted-foreground"
                />
                <span className="truncate">
                  <T>Jira tickets</T>
                </span>
                <span className="ml-auto shrink-0 text-sidebar-muted-foreground/60 text-xs tabular-nums">
                  {jiraCount}
                </span>
              </button>
            </li>
          ) : null}
          {folder.members.map((member) => (
            <FolderMemberRow
              key={member.projectId}
              environmentId={environmentId}
              folder={folder}
              member={member}
              threads={props.threadsByWorktree.get(
                folderThreadGroupKey({
                  environmentId,
                  projectId: member.projectId,
                  worktreePath: member.worktreePath,
                }),
              )}
              isActive={
                props.activeWorktree?.environmentId === environmentId &&
                props.activeWorktree.worktreePath === member.worktreePath
              }
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The folder session: threads whose working directory is the folder itself,
 * so they see every repository and plan across them.
 */
function FolderSessionRow(props: {
  environmentId: EnvironmentId;
  folder: Folder;
  threads: ReadonlyArray<EnvironmentThreadShell> | undefined;
  isActive: boolean;
}) {
  const { environmentId, folder } = props;
  const gt = useGT();
  const router = useRouter();
  const startFolderSession = useStartFolderSession();
  const threads = props.threads ?? [];
  const running = threads.some((thread) => threadRuntimeIsActive(thread.runtime));
  const newSession = () => void startFolderSession(environmentId, folder);
  const open = () => {
    const latest = threads[0];
    if (!latest) {
      newSession();
      return;
    }
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, latest.id)),
    });
  };
  return (
    <li
      className="group/member flex h-7 items-center gap-1 rounded-lg pr-1 hover:bg-sidebar-row-hover data-[active=true]:bg-sidebar-row-selected"
      data-active={props.isActive}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={open}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left text-sidebar-foreground text-sm"
            />
          }
        >
          <LayersIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
          <span className="truncate">
            <T>All repositories</T>
          </span>
          {running ? (
            <span
              aria-label={gt("Agent running")}
              className="size-1.5 shrink-0 rounded-full bg-primary"
            />
          ) : null}
          {threads.length > 0 ? (
            <span className="ml-auto shrink-0 text-sidebar-muted-foreground/60 text-xs tabular-nums">
              {threads.length}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">
          <span className="block">
            <T>Folder sessions work across every repository.</T>
          </span>
          <span className="block font-mono text-muted-foreground">{folder.path}</span>
        </TooltipPopup>
      </Tooltip>
      <Button
        size="icon-micro"
        variant="ghost"
        aria-label={gt("New folder session in {name}", { name: folder.name })}
        onClick={newSession}
      >
        <PlusIcon />
      </Button>
    </li>
  );
}

function FolderMemberRow(props: {
  environmentId: EnvironmentId;
  folder: Folder;
  member: FolderMember;
  threads: ReadonlyArray<EnvironmentThreadShell> | undefined;
  isActive: boolean;
}) {
  const { environmentId, folder, member } = props;
  const gt = useGT();
  const router = useRouter();
  const startFolderThread = useStartFolderThread();
  const archiveMember = useAtomCommand(folderEnvironment.archiveMember, { reportFailure: false });
  const restoreMember = useAtomCommand(folderEnvironment.restoreMember, { reportFailure: false });
  const copyEnvFiles = useAtomCommand(folderEnvironment.copyEnvFiles, { reportFailure: false });
  const recopyEnvFiles = async () => {
    const result = await copyEnvFiles({
      environmentId,
      input: { slug: folder.slug, projectId: member.projectId },
    });
    if (!settled(gt("Could not copy .env files"), result) || result._tag !== "Success") return;
    const copied =
      result.value.folder.members.find((entry) => entry.projectId === member.projectId)?.setup
        ?.envFiles ?? [];
    toastManager.add({
      type: "success",
      title:
        copied.length === 0
          ? gt("No .env files to copy into {repo}", { repo: member.repoName })
          : gt(
              "{count, plural, one {Copied {count} .env file into {repo}} other {Copied {count} .env files into {repo}}}",
              { count: copied.length, repo: member.repoName },
            ),
      ...(copied.length > 0 ? { description: copied.join(", ") } : {}),
    });
  };
  const isArchived = member.archivedAt !== null;
  const threads = props.threads ?? [];
  const running = threads.some((thread) => threadRuntimeIsActive(thread.runtime));
  // The worktree's git status carries its branch's pull request. Rows only
  // subscribe near the viewport, and share the query with the thread rows and
  // chat header for the same worktree.
  const { leaseLiveStatus, rowRef } = useSidebarRowSubscriptionLease(props.isActive);
  const gitStatus = useEnvironmentQuery(
    leaseLiveStatus && !isArchived
      ? vcsEnvironment.status({ environmentId, input: { cwd: member.worktreePath } })
      : null,
  );
  const visibleGitStatus = useRetainedValue(member.worktreePath, gitStatus.data);
  const prStatus = isArchived
    ? null
    : prStatusIndicator(visibleGitStatus?.pr ?? null, visibleGitStatus?.sourceControlProvider);

  const newThread = () => void startFolderThread(environmentId, folder, member);

  const open = () => {
    const latest = threads[0];
    if (!latest) {
      newThread();
      return;
    }
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, latest.id)),
    });
  };

  const archive = async () => {
    const input = { slug: folder.slug, projectId: member.projectId };
    let result = await archiveMember({ environmentId, input });
    if (
      isDirtyWorktreeFailure(result) &&
      (await confirmDiscard(
        gt("{repo} has uncommitted changes. Archive the worktree anyway and discard them?", {
          repo: member.repoName,
        }),
      ))
    ) {
      result = await archiveMember({ environmentId, input: { ...input, force: true } });
    }
    settled(gt("Could not archive the worktree"), result);
  };

  return (
    <li
      ref={rowRef}
      className="group/member flex h-7 items-center gap-1 rounded-lg pr-1 hover:bg-sidebar-row-hover data-[active=true]:bg-sidebar-row-selected"
      data-active={props.isActive}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={isArchived}
              onClick={open}
              className={cn(
                "flex h-full min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left text-sm",
                isArchived ? "text-sidebar-muted-foreground/50" : "text-sidebar-foreground",
              )}
            />
          }
        >
          {prStatus ? (
            <prStatus.Icon
              role="img"
              aria-label={prStatus.label}
              className={cn("size-3.5 shrink-0", prStatus.colorClass)}
            />
          ) : (
            <GitBranchIcon
              aria-hidden
              className="size-3.5 shrink-0 text-sidebar-muted-foreground"
            />
          )}
          <span className="truncate">{member.repoName}</span>
          <span className="truncate text-sidebar-muted-foreground/60 text-xs">
            {isArchived ? gt("archived", { $context: "worktree state" }) : member.branch}
          </span>
          {running ? (
            <span
              aria-label={gt("Agent running")}
              className="size-1.5 shrink-0 rounded-full bg-primary"
            />
          ) : null}
          {threads.length > 0 && !isArchived ? (
            <span className="ml-auto shrink-0 text-sidebar-muted-foreground/60 text-xs tabular-nums">
              {threads.length}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="right">
          {prStatus ? <span className="block">{prStatus.tooltip}</span> : null}
          <span className="block font-mono">{member.worktreePath}</span>
          {member.setup?.baseRef ? (
            <span className="block text-muted-foreground">
              <T>
                Started from <Var>{member.setup.baseRef}</Var>
              </T>
            </span>
          ) : null}
          {member.setup ? (
            <span className="block text-muted-foreground">
              {member.setup.envFiles.length === 0
                ? gt("No .env files copied")
                : gt(".env files: {files}", { files: member.setup.envFiles.join(", ") })}
            </span>
          ) : null}
        </TooltipPopup>
      </Tooltip>
      {isArchived ? null : (
        <Button
          size="icon-micro"
          variant="ghost"
          aria-label={gt("New thread in {repo}", { repo: member.repoName })}
          onClick={newThread}
        >
          <PlusIcon />
        </Button>
      )}
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost"
              aria-label={gt("{name} actions", { name: member.repoName })}
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          {isArchived ? (
            <MenuItem
              onClick={() =>
                void restoreMember({
                  environmentId,
                  input: { slug: folder.slug, projectId: member.projectId },
                }).then((result) => settled(gt("Could not restore the worktree"), result))
              }
            >
              <T>Restore worktree</T>
            </MenuItem>
          ) : (
            <>
              <MenuItem onClick={newThread}>
                <T>New thread</T>
              </MenuItem>
              <MenuItem onClick={() => void recopyEnvFiles()}>
                <T>
                  Copy .env files from <Var>{member.repoName}</Var>
                </T>
              </MenuItem>
              <MenuItem onClick={() => void navigator.clipboard.writeText(member.worktreePath)}>
                <T>Copy worktree path</T>
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => void archive()}>
                <T>Archive worktree</T>
              </MenuItem>
            </>
          )}
        </MenuPopup>
      </Menu>
    </li>
  );
}
