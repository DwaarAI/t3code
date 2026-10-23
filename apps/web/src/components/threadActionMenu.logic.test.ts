import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function allIds(state: ThreadActionMenuState): string[] {
  const flatten = (items: ReturnType<typeof buildThreadActionMenuItems>): string[] =>
    items.flatMap((item) => [item.id, ...(item.children ? flatten(item.children) : [])]);
  return flatten(buildThreadActionMenuItems(state));
}

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });

  it("offers review, handoff and session copies only where they apply", () => {
    const plain = allIds(baseState);
    for (const id of ["review", "handoff", "copy-session-id", "copy-resume-command"]) {
      expect(plain).not.toContain(id);
    }
    const folderThread = allIds({
      ...baseState,
      canReview: true,
      canHandoff: true,
      hasProviderSession: true,
    });
    expect(folderThread.slice(0, 2)).toEqual(["review", "handoff"]);
    expect(folderThread).toEqual(
      expect.arrayContaining(["copy-thread-id", "copy-session-id", "copy-resume-command"]),
    );
  });

  it("keeps session copies but not review or handoff on a read-only connection", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      canOperate: false,
      canReview: true,
      canHandoff: true,
      hasProviderSession: true,
    });
    const disabled = (id: string) =>
      [...items, ...items.flatMap((item) => item.children ?? [])].find((item) => item.id === id)
        ?.disabled === true;
    expect(disabled("review")).toBe(true);
    expect(disabled("handoff")).toBe(true);
    expect(disabled("copy-session-id")).toBe(false);
    expect(disabled("copy-resume-command")).toBe(false);
  });
});
