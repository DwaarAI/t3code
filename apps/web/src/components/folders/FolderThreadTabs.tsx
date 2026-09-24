import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { FolderThreadMatch } from "@t3tools/client-runtime/state/folders";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { FolderIcon, PlusIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useStartFolderSession, useStartFolderThread } from "../../hooks/useStartFolderThread";
import { useFolderHandoff } from "../../hooks/useFolderHandoff";
import { useStartReview } from "../../hooks/useStartReview";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { useFolderForThread } from "../../state/folders";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";

/**
 * Browser-style tabs for the threads of one folder worktree, or of the folder
 * session. Renders nothing outside folders, so ordinary threads keep their
 * layout.
 */
export const FolderThreadTabs = memo(function FolderThreadTabs(props: FolderThreadTabsProps) {
  const match = useFolderForThread(props.environmentId, props.projectId, props.worktreePath);
  // Only folder threads pay for the thread-shell subscription below.
  return match === null ? null : <FolderThreadTabStrip {...props} match={match} />;
});

interface FolderThreadTabsProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly worktreePath: string | null;
  /** False for a draft, which has no thread to hand off yet. */
  readonly isServerThread: boolean;
}

function FolderThreadTabStrip(
  props: FolderThreadTabsProps & { readonly match: FolderThreadMatch },
) {
  const { environmentId, threadId, match } = props;
  const { folder, member } = match;
  const router = useRouter();
  const startFolderThread = useStartFolderThread();
  const startFolderSession = useStartFolderSession();
  const handOff = useFolderHandoff();
  const startReview = useStartReview();
  const allThreads = useThreadShells();
  const threads = useMemo(
    () =>
      allThreads
        .filter(
          (thread) =>
            thread.environmentId === environmentId &&
            thread.archivedAt === null &&
            (member
              ? thread.worktreePath === member.worktreePath
              : thread.worktreePath === null && thread.projectId === folder.rootProjectId),
        )
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [allThreads, environmentId, folder.rootProjectId, member],
  );
  const scopeLabel = member?.repoName ?? "All repositories";
  const isDraft = !threads.some((thread) => thread.id === threadId);
  const current = threads.find((thread) => thread.id === threadId);

  const newThread = () =>
    void (member
      ? startFolderThread(environmentId, folder, member)
      : startFolderSession(environmentId, folder));

  return (
    <div className="flex h-9 min-w-0 shrink-0 items-center gap-1 border-border border-b bg-background px-2">
      <span className="flex min-w-0 shrink-0 items-center gap-1.5 pr-1 text-muted-foreground text-xs">
        <FolderIcon aria-hidden className="size-3.5" />
        <span className="max-w-32 truncate">{folder.name}</span>
        <span aria-hidden>/</span>
        <span className="max-w-32 truncate">{scopeLabel}</span>
      </span>
      <div
        role="tablist"
        aria-label={`Threads in ${scopeLabel}`}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
      >
        {threads.map((thread) => {
          const selected = thread.id === threadId;
          return (
            <button
              key={thread.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                if (selected) return;
                void router.navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(scopeThreadRef(environmentId, thread.id)),
                });
              }}
              className={cn(
                "flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs",
                selected
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {thread.session?.status === "running" ? (
                <span aria-label="Running" className="size-1.5 shrink-0 rounded-full bg-primary" />
              ) : null}
              <span className="truncate">{thread.title}</span>
            </button>
          );
        })}
        {isDraft ? (
          <span
            role="tab"
            aria-selected
            className="flex h-7 shrink-0 items-center rounded-md bg-accent px-2.5 font-medium text-foreground text-xs"
          >
            New thread
          </span>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={member ? "New thread in this worktree" : "New folder session"}
          onClick={newThread}
        >
          <PlusIcon />
        </Button>
      </div>
      {props.isServerThread && current ? (
        <>
          <Button size="xs" variant="ghost" onClick={() => void startReview(current)}>
            Review
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void handOff(current)}>
            Handoff
          </Button>
        </>
      ) : null}
    </div>
  );
}
