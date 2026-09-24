import { describe, expect, it } from "@effect/vitest";

import { providerResumeCommand } from "./providerSessionRef.ts";

describe("providerResumeCommand", () => {
  it("resumes Claude and Codex sessions from the thread's directory", () => {
    expect(
      providerResumeCommand({ provider: "claudeAgent", sessionId: "abc-123", cwd: "/w/api" }),
    ).toBe("cd /w/api && claude --resume abc-123");
    expect(providerResumeCommand({ provider: "codex", sessionId: "th_1", cwd: null })).toBe(
      "codex resume th_1",
    );
  });

  it("quotes paths a shell would split", () => {
    expect(
      providerResumeCommand({ provider: "codex", sessionId: "th_1", cwd: "/w/it's here" }),
    ).toBe("cd '/w/it'\\''s here' && codex resume th_1");
  });

  it("has no command for providers without a resume CLI", () => {
    expect(providerResumeCommand({ provider: "cursor", sessionId: "s", cwd: "/w" })).toBeNull();
  });
});
