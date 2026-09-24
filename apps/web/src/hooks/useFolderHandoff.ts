import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { useCallback } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { folderEnvironment } from "../state/folders";
import { useAtomCommand } from "../state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

type HandoffSource = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "branch" | "worktreePath"
>;

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Continue a folder thread in a fresh one: the server writes a handoff note
 * into the folder's `.context/handoffs/`, and a new draft in the same worktree
 * opens with that note attached, ready for the next instruction.
 */
export function useFolderHandoff() {
  const writeHandoff = useAtomCommand(folderEnvironment.writeHandoff, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  return useCallback(
    async (thread: HandoffSource) => {
      const written = await writeHandoff({
        environmentId: thread.environmentId,
        input: { threadId: thread.id },
      });
      if (written._tag === "Failure") {
        if (!isAtomCommandInterrupted(written)) {
          failureToast("Could not write the handoff note", squashAtomCommandFailure(written));
        }
        return;
      }
      const created = await settlePromise(() =>
        handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId), {
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          // A folder session has no worktree; it runs in the folder's own project.
          envMode: thread.worktreePath ? "worktree" : "local",
          startFromOrigin: false,
        }),
      );
      if (created._tag === "Failure" || created.value === null) {
        if (created._tag === "Failure") {
          failureToast("Could not create thread", squashAtomCommandFailure(created));
        }
        return;
      }
      const store = useComposerDraftStore.getState();
      const existing = store.getComposerDraft(created.value.draftId)?.prompt.trim() ?? "";
      const handoff = `Continue from the handoff note ${serializeComposerFileLink(written.value.path)} `;
      store.setPrompt(created.value.draftId, existing ? `${handoff}\n\n${existing}` : handoff);
    },
    [handleNewThread, writeHandoff],
  );
}
