import type { ProviderDriverKind } from "@t3tools/contracts";

const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/**
 * The id a provider's own CLI uses for a session, read from the resume cursor
 * its adapter persists. Claude's cursor also carries T3 Code's thread id under
 * `threadId`, so each provider reads its own field.
 */
export function nativeProviderSessionId(
  provider: ProviderDriverKind | string,
  resumeCursor: unknown,
): string | null {
  if (typeof resumeCursor !== "object" || resumeCursor === null) return null;
  const cursor = resumeCursor as Record<string, unknown>;
  switch (provider) {
    case "claudeAgent":
      // `sessionId` is the pre-`resume` spelling some persisted cursors keep.
      return nonEmpty(cursor.resume) ?? nonEmpty(cursor.sessionId);
    case "codex":
      return nonEmpty(cursor.threadId);
    default:
      return nonEmpty(cursor.sessionId);
  }
}
