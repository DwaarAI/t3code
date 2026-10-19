/**
 * GhCli - Runs the GitHub CLI with the server's `gh` login, for the fork
 * features that talk to GitHub (GitHub Actions, issue-backed folders).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

const TIMEOUT = "30 seconds";
const MAX_OUTPUT_BYTES = 8_000_000;
const MAX_SUMMARY_CHARS = 300;

export class GhCliError extends Schema.TaggedError<GhCliError>()("GhCliError", {
  reason: Schema.Literals(["not_installed", "not_authenticated", "timed_out", "command_failed"]),
  exitCode: Schema.optional(Schema.Number),
  /** The last line `gh` printed to stderr, trimmed; it names what GitHub refused. */
  summary: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not_installed":
        return "GitHub CLI (`gh`) is required but not available on PATH.";
      case "not_authenticated":
        return "GitHub CLI is not authenticated. Run `gh auth login` and retry.";
      case "timed_out":
        return "GitHub CLI timed out.";
      case "command_failed":
        return this.summary
          ? `GitHub CLI failed: ${this.summary}`
          : `GitHub CLI exited with code ${this.exitCode ?? "unknown"}.`;
    }
  }
}

export class GhCli extends Context.Service<
  GhCli,
  {
    /** Runs `gh <args>` and resolves to its stdout; a non-zero exit fails. */
    readonly run: (input: {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly stdin?: string;
    }) => Effect.Effect<string, GhCliError>;
  }
>()("t3/githubActions/GhCli") {}

/** Classifies a finished `gh` run that exited non-zero. */
const classifyFailure = (exitCode: number, stderr: string): GhCliError => {
  const summary = stderr
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.length > 0)
    ?.slice(0, MAX_SUMMARY_CHARS);
  const notAuthenticated = /gh auth login|not logged in|authentication required/i.test(stderr);
  return new GhCliError({
    reason: notAuthenticated ? "not_authenticated" : "command_failed",
    exitCode,
    ...(summary ? { summary } : {}),
  });
};

const make = Effect.gen(function* () {
  const processes = yield* ProcessRunner.ProcessRunner;

  const run: GhCli["Service"]["run"] = (input) =>
    processes
      .run({
        command: "gh",
        args: input.args,
        cwd: input.cwd,
        timeout: TIMEOUT,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        // No prompts: a missing login must fail, not wait for a terminal.
        env: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
        ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new GhCliError({
              reason:
                cause._tag === "ProcessSpawnError"
                  ? "not_installed"
                  : cause._tag === "ProcessTimeoutError"
                    ? "timed_out"
                    : "command_failed",
              cause,
            }),
        ),
        Effect.flatMap((output) =>
          output.code === 0
            ? Effect.succeed(output.stdout)
            : Effect.fail(classifyFailure(output.code ?? -1, output.stderr)),
        ),
      );

  return GhCli.of({ run });
});

export const layer = Layer.effect(GhCli, make);
