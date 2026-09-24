import { describe, expect, it } from "@effect/vitest";

import { nativeProviderSessionId } from "./nativeSessionId.ts";

describe("nativeProviderSessionId", () => {
  it("reads Claude's resume id, never T3's own thread id", () => {
    const cursor = { threadId: "t3-thread", resume: "5d0b3f6e-1a2b-4c3d-8e9f-001122334455" };
    expect(nativeProviderSessionId("claudeAgent", cursor)).toBe(
      "5d0b3f6e-1a2b-4c3d-8e9f-001122334455",
    );
    expect(nativeProviderSessionId("claudeAgent", { threadId: "t3-thread" })).toBeNull();
    expect(nativeProviderSessionId("claudeAgent", { sessionId: "legacy" })).toBe("legacy");
  });

  it("reads Codex's thread id and other providers' session id", () => {
    expect(nativeProviderSessionId("codex", { threadId: "codex-thread" })).toBe("codex-thread");
    expect(nativeProviderSessionId("cursor", { schemaVersion: 1, sessionId: "cur-1" })).toBe(
      "cur-1",
    );
  });

  it("returns null without a usable cursor", () => {
    expect(nativeProviderSessionId("codex", null)).toBeNull();
    expect(nativeProviderSessionId("codex", { threadId: "  " })).toBeNull();
    expect(nativeProviderSessionId("opencode", "not-an-object")).toBeNull();
  });
});
