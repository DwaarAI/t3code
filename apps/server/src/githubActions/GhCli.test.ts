import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";

import * as ProcessRunner from "../processRunner.ts";
import * as GhCli from "./GhCli.ts";

const output = (code: number, stdout: string, stderr = ""): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr,
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

/** Runs `gh` against a fake process runner and records each invocation. */
const withGh = (
  respond: (
    input: ProcessRunner.ProcessRunInput,
  ) => Effect.Effect<ProcessRunner.ProcessRunOutput, ProcessRunner.ProcessRunError>,
) => {
  const calls: ProcessRunner.ProcessRunInput[] = [];
  const layer = GhCli.layer.pipe(
    Layer.provide(
      Layer.succeed(
        ProcessRunner.ProcessRunner,
        ProcessRunner.ProcessRunner.of({
          run: (input) => {
            calls.push(input);
            return respond(input);
          },
        }),
      ),
    ),
  );
  return { calls, gh: Effect.service(GhCli.GhCli).pipe(Effect.provide(layer)) };
};

describe("GhCli", () => {
  it.effect("runs gh without prompts and resolves to stdout", () =>
    Effect.gen(function* () {
      const { calls, gh } = withGh(() => Effect.succeed(output(0, "[]")));
      const stdout = yield* (yield* gh).run({
        cwd: "/repo",
        args: ["run", "list", "--repo", "acme/app"],
        stdin: "{}",
      });
      expect(stdout).toBe("[]");
      expect(calls).toMatchObject([
        {
          command: "gh",
          args: ["run", "list", "--repo", "acme/app"],
          cwd: "/repo",
          stdin: "{}",
          env: { GH_PROMPT_DISABLED: "1" },
        },
      ]);
    }),
  );

  it.effect("fails a non-zero exit with gh's last stderr line", () =>
    Effect.gen(function* () {
      const { gh } = withGh(() =>
        Effect.succeed(
          output(
            1,
            "",
            "warning: x\nHTTP 422: Workflow does not have 'workflow_dispatch' trigger\n",
          ),
        ),
      );
      const error = yield* (yield* gh)
        .run({ cwd: "/repo", args: ["workflow", "run"] })
        .pipe(Effect.flip);
      expect(error.reason).toBe("command_failed");
      expect(error.exitCode).toBe(1);
      expect(error.message).toBe(
        "GitHub CLI failed: HTTP 422: Workflow does not have 'workflow_dispatch' trigger",
      );
    }),
  );

  it.effect("tells a missing login and a missing gh apart", () =>
    Effect.gen(function* () {
      const loggedOut = withGh(() =>
        Effect.succeed(output(4, "", "To get started with GitHub CLI, please run:  gh auth login")),
      );
      const unauthenticated = yield* (yield* loggedOut.gh)
        .run({ cwd: "/repo", args: ["api", "user"] })
        .pipe(Effect.flip);
      expect(unauthenticated.reason).toBe("not_authenticated");

      const missing = withGh((input) =>
        Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: input.command,
            argumentCount: input.args.length,
            cause: new Error("spawn gh ENOENT"),
          }),
        ),
      );
      const notInstalled = yield* (yield* missing.gh)
        .run({ cwd: "/repo", args: ["api", "user"] })
        .pipe(Effect.flip);
      expect(notInstalled.reason).toBe("not_installed");
    }),
  );
});
