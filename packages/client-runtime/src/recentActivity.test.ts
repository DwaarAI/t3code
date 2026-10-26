import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { selectRecentActivity, type RecentActivityThread } from "./recentActivity.ts";

const at = (minute: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(Date.UTC(2026, 9, 20, 9, minute)));

const thread = (
  id: string,
  times: { updated: number; prompt?: number; viewed?: number },
  overrides: Partial<RecentActivityThread> = {},
) => ({
  id,
  updatedAt: at(times.updated),
  latestUserMessageAt: times.prompt === undefined ? null : at(times.prompt),
  lastVisitedAt: times.viewed === undefined ? null : at(times.viewed),
  archivedAt: null,
  deletedAt: null,
  ...overrides,
});

const ids = (threads: ReadonlyArray<{ readonly id: string }>) => threads.map(({ id }) => id);

describe("selectRecentActivity", () => {
  const threads = [
    thread("a", { updated: 50, prompt: 10, viewed: 1 }),
    thread("b", { updated: 20, prompt: 30, viewed: 3 }),
    thread("c", { updated: 30, viewed: 2 }),
    thread("never-viewed", { updated: 59, prompt: 59 }),
  ];

  it("keeps only viewed threads and orders the stack by the chosen time", () => {
    expect(ids(selectRecentActivity(threads, "viewed"))).toEqual(["b", "c", "a"]);
    expect(ids(selectRecentActivity(threads, "updated"))).toEqual(["a", "c", "b"]);
    // A thread with no prompt yet sorts after the ones that have one.
    expect(ids(selectRecentActivity(threads, "prompt"))).toEqual(["b", "a", "c"]);
  });

  it("picks the stack by last viewed before sorting, so sorting never pulls in older threads", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      // The least recently viewed threads were updated most recently.
      thread(`t${index}`, { updated: 59 - index, viewed: index }),
    );
    const stack = selectRecentActivity(many, "updated");
    expect(stack).toHaveLength(10);
    expect(ids(stack)).not.toContain("t0");
    expect(ids(stack)).not.toContain("t1");
    expect(ids(stack)[0]).toBe("t2");
  });

  it("leaves out archived and deleted threads", () => {
    const stack = selectRecentActivity(
      [
        thread("archived", { updated: 1, viewed: 9 }, { archivedAt: at(9) }),
        thread("deleted", { updated: 1, viewed: 8 }, { deletedAt: at(8) }),
        thread("kept", { updated: 1, viewed: 1 }),
      ],
      "viewed",
    );
    expect(ids(stack)).toEqual(["kept"]);
  });

  it("breaks ties on the chosen time by last viewed", () => {
    const stack = selectRecentActivity(
      [
        thread("older-view", { updated: 5, viewed: 1 }),
        thread("newer-view", { updated: 5, viewed: 2 }),
      ],
      "updated",
    );
    expect(ids(stack)).toEqual(["newer-view", "older-view"]);
  });
});
