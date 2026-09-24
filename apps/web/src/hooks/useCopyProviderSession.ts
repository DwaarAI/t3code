import { providerResumeCommand } from "@t3tools/client-runtime/state/providerSessionRef";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { providerSessionRef } from "../state/providerSessionRef";
import { useAtomCommand } from "../state/use-atom-command";
import { useCopyToClipboard } from "./useCopyToClipboard";

/**
 * Copies a thread's provider session id, or the command that resumes it in
 * the provider's own CLI, fetched when asked so menus open without waiting.
 */
export function useCopyProviderSession() {
  const fetchRef = useAtomCommand(providerSessionRef.fetch, { reportFailure: false });
  const { copyToClipboard } = useCopyToClipboard<{ label: string; value: string }>({
    onCopy: ({ label, value }) => {
      toastManager.add({ type: "success", title: `${label} copied`, description: value });
    },
    onError: (error, { label }) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not copy ${label}`,
          description: error.message,
        }),
      );
    },
  });

  return useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly cwd: string | null;
      readonly what: "session-id" | "resume-command";
    }) => {
      const result = await fetchRef({
        environmentId: input.environmentId,
        input: { threadId: input.threadId },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not read the session",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      const { provider, sessionId } = result.value;
      if (sessionId === null) {
        toastManager.add({
          type: "info",
          title: "No provider session yet",
          description: "The provider reports its session id after the first message.",
        });
        return;
      }
      if (input.what === "session-id") {
        copyToClipboard(sessionId, { label: "Session ID", value: sessionId });
        return;
      }
      const command = providerResumeCommand({ provider, sessionId, cwd: input.cwd });
      if (command === null) {
        toastManager.add({
          type: "info",
          title: "No resume command",
          description: "Only Claude Code and Codex sessions can be resumed from a terminal.",
        });
        return;
      }
      copyToClipboard(command, { label: "Resume command", value: command });
    },
    [copyToClipboard, fetchRef],
  );
}
