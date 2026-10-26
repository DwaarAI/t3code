import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderThreadId } from "@t3tools/contracts";

import { providerSessionRefOf } from "./providerSessionRef.ts";

const providerThread = (id: string, driver: string, nativeId: string | null) => ({
  id: ProviderThreadId.make(id),
  driver: ProviderDriverKind.make(driver),
  nativeThreadRef:
    nativeId === null
      ? null
      : { driver: ProviderDriverKind.make(driver), nativeId, strength: "strong" as const },
});

describe("providerSessionRefOf", () => {
  it("reads the active provider thread's native id", () => {
    expect(
      providerSessionRefOf({
        thread: { activeProviderThreadId: ProviderThreadId.make("pt-1") },
        providerThreads: [
          providerThread("pt-1", "claudeAgent", "claude-session"),
          providerThread("pt-2", "codex", "codex-session"),
        ],
      }),
    ).toEqual({ provider: "claudeAgent", sessionId: "claude-session" });
  });

  it("falls back to the latest provider thread once none is active", () => {
    expect(
      providerSessionRefOf({
        thread: { activeProviderThreadId: null },
        providerThreads: [
          providerThread("pt-1", "claudeAgent", "claude-session"),
          providerThread("pt-2", "codex", null),
        ],
      }),
    ).toEqual({ provider: "codex", sessionId: null });
    expect(
      providerSessionRefOf({ thread: { activeProviderThreadId: null }, providerThreads: [] }),
    ).toEqual({ provider: null, sessionId: null });
  });
});
