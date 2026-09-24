import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/**
 * The provider's own session id for a thread (`claude --resume`, `codex
 * resume`). Read on demand: it only matters when someone looks for it.
 */
export function createProviderSessionRefAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    ref: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:provider:session-ref",
      tag: WS_METHODS.providerGetSessionRef,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
    }),
    fetch: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider:session-ref-fetch",
      tag: WS_METHODS.providerGetSessionRef,
    }),
  };
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The terminal command that reopens a thread's session in the provider's own
 * CLI, run from the thread's directory, or null for providers without one.
 */
export function providerResumeCommand(input: {
  readonly provider: string | null;
  readonly sessionId: string;
  readonly cwd: string | null;
}): string | null {
  const resume =
    input.provider === "claudeAgent"
      ? `claude --resume ${shellQuote(input.sessionId)}`
      : input.provider === "codex"
        ? `codex resume ${shellQuote(input.sessionId)}`
        : null;
  if (resume === null) return null;
  return input.cwd ? `cd ${shellQuote(input.cwd)} && ${resume}` : resume;
}
