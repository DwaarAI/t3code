import type {
  OrchestrationV2AppThread,
  OrchestrationV2ProviderThread,
  ProviderSessionRef,
} from "@t3tools/contracts";

/**
 * The id a thread's provider CLI knows its session by (`claude --resume <id>`,
 * `codex resume <id>`): the active provider thread's native ref, else the
 * latest one, for threads whose provider has stopped.
 */
export function providerSessionRefOf(records: {
  readonly thread: Pick<OrchestrationV2AppThread, "activeProviderThreadId">;
  readonly providerThreads: ReadonlyArray<
    Pick<OrchestrationV2ProviderThread, "id" | "driver" | "nativeThreadRef">
  >;
}): ProviderSessionRef {
  const providerThread =
    records.providerThreads.find(
      (candidate) => candidate.id === records.thread.activeProviderThreadId,
    ) ?? records.providerThreads.at(-1);
  return {
    provider: providerThread?.driver ?? null,
    sessionId: providerThread?.nativeThreadRef?.nativeId ?? null,
  };
}
