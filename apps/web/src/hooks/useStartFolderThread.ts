import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, Folder, FolderMember } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { readThreadShells, waitForProject } from "../state/entities";
import { folderEnvironment } from "../state/folders";
import { useAtomCommand } from "../state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

/**
 * Opens a draft in a folder worktree. The first thread there starts from the
 * folder's suggested prompt, such as the one a GitHub issue staged.
 */
export function useStartFolderThread() {
  const handleNewThread = useNewThreadHandler();
  return useCallback(
    async (environmentId: EnvironmentId, folder: Folder, member: FolderMember) => {
      const created = await handleNewThread(scopeProjectRef(environmentId, member.projectId), {
        branch: member.branch,
        worktreePath: member.worktreePath,
        envMode: "worktree",
        startFromOrigin: false,
      });
      if (!created || !folder.initialPrompt) return created;
      const worktreeHasThreads = readThreadShells().some(
        (thread) =>
          thread.environmentId === environmentId && thread.worktreePath === member.worktreePath,
      );
      const store = useComposerDraftStore.getState();
      const draftPrompt = store.getComposerDraft(created.draftId)?.prompt.trim() ?? "";
      if (!worktreeHasThreads && draftPrompt === "") {
        store.setPrompt(created.draftId, folder.initialPrompt);
      }
      return created;
    },
    [handleNewThread],
  );
}

/**
 * Opens a draft in the folder session, the thread level that spans every
 * repository. The server creates the folder's own project on first use.
 */
export function useStartFolderSession() {
  const openRoot = useAtomCommand(folderEnvironment.openRoot, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  return useCallback(
    async (environmentId: EnvironmentId, folder: Folder) => {
      const opened = await openRoot({ environmentId, input: { slug: folder.slug } });
      if (opened._tag === "Failure") {
        if (!isAtomCommandInterrupted(opened)) {
          const error = squashAtomCommandFailure(opened);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not open a folder session",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return null;
      }
      const rootProjectId = opened.value.folder.rootProjectId;
      if (!rootProjectId) return null;
      const projectRef = scopeProjectRef(environmentId, rootProjectId);
      // A project created just now reaches this client through the event stream.
      await waitForProject(projectRef, 5_000).catch(() => null);
      return handleNewThread(projectRef, {
        branch: null,
        worktreePath: null,
        envMode: "local",
        startFromOrigin: false,
      });
    },
    [handleNewThread, openRoot],
  );
}
