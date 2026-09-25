import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type AttentionReminderThread,
  planAttentionReminders,
  threadAttentionReminder,
} from "./attentionReminders.ts";

const ENV = EnvironmentId.make("env-1");
const OTHER_ENV = EnvironmentId.make("env-2");
const NOW = Date.parse("2026-01-01T12:00:00.000Z");

function thread(overrides: Partial<AttentionReminderThread> = {}): AttentionReminderThread {
  return {
    id: ThreadId.make("thread-1"),
    title: "Fix the build",
    archivedAt: null,
    snoozedUntil: null,
    latestTurn: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...overrides,
  };
}

function withTurn(turnId: string): Pick<AttentionReminderThread, "latestTurn"> {
  return {
    latestTurn: {
      turnId: TurnId.make(turnId),
      state: "running",
      requestedAt: "2026-01-01T11:59:00.000Z",
      startedAt: "2026-01-01T11:59:00.000Z",
      completedAt: null,
      assistantMessageId: null,
    },
  };
}

describe("threadAttentionReminder", () => {
  it("reminds about pending approvals before pending questions", () => {
    const reminder = threadAttentionReminder(
      ENV,
      thread({ ...withTurn("turn-1"), hasPendingApprovals: true, hasPendingUserInput: true }),
      NOW,
    );
    expect(reminder?.kind).toBe("approval");
    expect(reminder?.threadTitle).toBe("Fix the build");
  });

  it("ignores threads that need nothing, are archived, or are snoozed", () => {
    expect(threadAttentionReminder(ENV, thread(), NOW)).toBeNull();
    expect(
      threadAttentionReminder(
        ENV,
        thread({ hasPendingUserInput: true, archivedAt: "2026-01-01T00:00:00.000Z" }),
        NOW,
      ),
    ).toBeNull();
    expect(
      threadAttentionReminder(
        ENV,
        thread({ hasPendingUserInput: true, snoozedUntil: "2026-01-01T13:00:00.000Z" }),
        NOW,
      ),
    ).toBeNull();
    expect(
      threadAttentionReminder(
        ENV,
        thread({ hasPendingUserInput: true, snoozedUntil: "2026-01-01T11:00:00.000Z" }),
        NOW,
      )?.kind,
    ).toBe("input");
  });

  it("gives a new id when a later turn asks again", () => {
    const first = threadAttentionReminder(
      ENV,
      thread({ ...withTurn("turn-1"), hasPendingApprovals: true }),
      NOW,
    );
    const second = threadAttentionReminder(
      ENV,
      thread({ ...withTurn("turn-2"), hasPendingApprovals: true }),
      NOW,
    );
    expect(first?.id).not.toBe(second?.id);
  });
});

describe("planAttentionReminders", () => {
  const pending = thread({ ...withTurn("turn-1"), hasPendingApprovals: true });
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
