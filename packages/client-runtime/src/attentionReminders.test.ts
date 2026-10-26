import {
  EnvironmentId,
  type OrchestrationV2ThreadShell,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  environmentAttentionReminders,
  planAttentionReminders,
  threadAttentionReminder,
} from "./attentionReminders.ts";
import { v2Now, v2ThreadShell } from "./state/orchestrationV2TestFixtures.ts";

const ENV = EnvironmentId.make("env-1");
const OTHER_ENV = EnvironmentId.make("env-2");
const NOW = DateTime.toEpochMillis(v2Now);

function thread(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return { ...v2ThreadShell, title: "Fix the build", ...overrides };
}

function pendingRequest(
  id: string,
  kind: "command" | "user_input" | "auth_refresh" = "command",
): Pick<OrchestrationV2ThreadShell, "pendingRuntimeRequest"> {
  return { pendingRuntimeRequest: { id: RuntimeRequestId.make(id), kind, createdAt: v2Now } };
}

const at = (offsetMs: number) => DateTime.makeUnsafe(NOW + offsetMs);

describe("threadAttentionReminder", () => {
  it("reminds about approvals and questions, not auth refreshes", () => {
    expect(threadAttentionReminder(ENV, thread(pendingRequest("r1")), NOW)).toMatchObject({
      kind: "approval",
      threadTitle: "Fix the build",
    });
    expect(
      threadAttentionReminder(ENV, thread(pendingRequest("r1", "user_input")), NOW)?.kind,
    ).toBe("input");
    expect(
      threadAttentionReminder(ENV, thread(pendingRequest("r1", "auth_refresh")), NOW),
    ).toBeNull();
  });

  it("ignores threads that need nothing, are archived, or are snoozed", () => {
    expect(threadAttentionReminder(ENV, thread(), NOW)).toBeNull();
    expect(
      threadAttentionReminder(
        ENV,
        thread({ ...pendingRequest("r1", "user_input"), archivedAt: at(-1) }),
        NOW,
      ),
    ).toBeNull();
    expect(
      threadAttentionReminder(
        ENV,
        thread({ ...pendingRequest("r1", "user_input"), snoozedUntil: at(60_000) }),
        NOW,
      ),
    ).toBeNull();
    expect(
      threadAttentionReminder(
        ENV,
        thread({ ...pendingRequest("r1", "user_input"), snoozedUntil: at(-60_000) }),
        NOW,
      )?.kind,
    ).toBe("input");
  });

  it("gives a new id when a later request asks again", () => {
    const first = threadAttentionReminder(ENV, thread(pendingRequest("r1")), NOW);
    const second = threadAttentionReminder(ENV, thread(pendingRequest("r2")), NOW);
    expect(first?.id).not.toBe(second?.id);
  });
});

describe("environmentAttentionReminders", () => {
  it("reminds on the parent when its subagent is waiting", () => {
    const parentId = ThreadId.make("parent");
    const parent = thread({
      id: parentId,
      title: "Parent",
      latestRunId: RunId.make("run-1"),
      lineage: { rootThreadId: parentId, parentThreadId: null, relationshipToParent: null },
    });
    const child = thread({
      ...pendingRequest("child-request", "user_input"),
      id: ThreadId.make("child"),
      title: "Child",
      status: "running",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const reminders = environmentAttentionReminders(ENV, [parent, child], NOW);
    expect(reminders.map((reminder) => [reminder.threadId, reminder.kind])).toEqual([
      [parentId, "input"],
    ]);
  });
});

describe("planAttentionReminders", () => {
  const pending = thread(pendingRequest("r1"));
  const pendingId = threadAttentionReminder(ENV, pending, NOW)!.id;

  it("schedules a new request once and keeps it while it stays pending", () => {
    const first = planAttentionReminders({
      environments: [{ environmentId: ENV, live: true, threads: [pending] }],
      scheduled: new Map(),
      nowMs: NOW,
    });
    expect(first.schedule.map((reminder) => reminder.id)).toEqual([pendingId]);
    expect(first.cancel).toEqual([]);

    const again = planAttentionReminders({
      environments: [{ environmentId: ENV, live: true, threads: [pending] }],
      scheduled: new Map([[pendingId, ENV]]),
      nowMs: NOW,
    });
    expect(again).toEqual({ schedule: [], cancel: [] });
  });

  it("cancels once a live shell shows the request handled", () => {
    const plan = planAttentionReminders({
      environments: [{ environmentId: ENV, live: true, threads: [thread()] }],
      scheduled: new Map([[pendingId, ENV]]),
      nowMs: NOW,
    });
    expect(plan).toEqual({ schedule: [], cancel: [pendingId] });
  });

  it("leaves reminders alone while the shell is not live", () => {
    const plan = planAttentionReminders({
      environments: [{ environmentId: ENV, live: false, threads: [thread()] }],
      scheduled: new Map([[pendingId, ENV]]),
      nowMs: NOW,
    });
    expect(plan).toEqual({ schedule: [], cancel: [] });
  });

  it("cancels reminders for environments that were removed", () => {
    const plan = planAttentionReminders({
      environments: [{ environmentId: OTHER_ENV, live: true, threads: [] }],
      scheduled: new Map([[pendingId, ENV]]),
      nowMs: NOW,
    });
    expect(plan.cancel).toEqual([pendingId]);
  });
});
