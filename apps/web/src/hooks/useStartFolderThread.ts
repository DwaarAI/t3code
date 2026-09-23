import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, Folder, FolderMember } from "@t3tools/contracts";
import { useCallback } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { readThreadShells } from "../state/entities";
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
