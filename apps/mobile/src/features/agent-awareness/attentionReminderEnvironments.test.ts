import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  type OrchestrationV2ThreadShell,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { makeRawThreadShell } from "../../test-fixtures";
import { selectAttentionReminderEnvironments } from "./attentionReminderEnvironments";

const ENV = EnvironmentId.make("env-1");
const NOW = Date.parse("2026-01-02T00:00:00.000Z");

function shell(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  status: EnvironmentShellState["status"] = "live",
): EnvironmentShellState {
  return {
    status,
    error: Option.none(),
    snapshot: Option.some({
      schemaVersion: 1,
      snapshotSequence: 1,
      projects: [],
      threads,
      archivedThreads: [],
    }),
  };
}

const waiting = makeRawThreadShell({
  id: ThreadId.make("waiting"),
  pendingRuntimeRequest: {
    id: RuntimeRequestId.make("request-1"),
    kind: "command",
    createdAt: DateTime.makeUnsafe(NOW),
  },
});
const idle = makeRawThreadShell({ id: ThreadId.make("idle") });

describe("selectAttentionReminderEnvironments", () => {
  it("hands live threads to the planner and withholds threads from non-live shells", () => {
    const live = selectAttentionReminderEnvironments(
      [{ environmentId: ENV, state: shell([waiting, idle]) }],
      NOW,
      null,
    );
    expect(live.environments).toEqual([
      { environmentId: ENV, live: true, threads: [waiting, idle] },
    ]);

    const cached = selectAttentionReminderEnvironments(
      [{ environmentId: ENV, state: shell([waiting], "cached") }],
      NOW,
      live,
    );
    expect(cached.environments).toEqual([{ environmentId: ENV, live: false, threads: [] }]);
  });

  it("keeps the previous selection until the pending reminders change", () => {
    const first = selectAttentionReminderEnvironments(
      [{ environmentId: ENV, state: shell([waiting, idle]) }],
      NOW,
      null,
    );
    const retitled = selectAttentionReminderEnvironments(
      [{ environmentId: ENV, state: shell([waiting, { ...idle, title: "Renamed" }]) }],
      NOW,
      first,
    );
    expect(retitled).toBe(first);

    const answered = selectAttentionReminderEnvironments(
      [{ environmentId: ENV, state: shell([{ ...waiting, pendingRuntimeRequest: null }, idle]) }],
      NOW,
      first,
    );
    expect(answered).not.toBe(first);
  });

  it("re-selects when a subagent's request reaches its parent", () => {
    const parent = makeRawThreadShell({
      id: ThreadId.make("parent"),
      latestRunId: RunId.make("run-1"),
    });
    const subagent = makeRawThreadShell({
      id: ThreadId.make("subagent"),
      status: "waiting",
      lineage: {
        rootThreadId: parent.id,
        parentThreadId: parent.id,
        relationshipToParent: "subagent",
      },
    });
    const before = selectAttentionReminderEnvironments(
      [{ environmentId: ENV, state: shell([parent, subagent]) }],
      NOW,
      null,
    );
    const after = selectAttentionReminderEnvironments(
      [
        {
          environmentId: ENV,
          state: shell([
            parent,
            { ...subagent, pendingRuntimeRequest: waiting.pendingRuntimeRequest },
          ]),
        },
      ],
      NOW,
      before,
    );
    expect(after).not.toBe(before);
  });
});
