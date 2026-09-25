import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./assets/notification-completion.mp3", () => ({ default: "completion.mp3" }));
vi.mock("./assets/notification-input.mp3", () => ({ default: "input.mp3" }));

import { setNotificationBadge, showTestNotification } from "./threadNotifications";

class TestNotification extends EventTarget {
  static sent: TestNotification[] = [];
  close = vi.fn();
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    super();
    TestNotification.sent.push(this);
  }
}

let focused = false;
const setBadge = vi.fn((_badge: { count: number; image: string | null }) => Promise.resolve());
const badgeCounts = () => setBadge.mock.calls.map(([badge]) => badge.count);

beforeEach(() => {
  focused = false;
  TestNotification.sent = [];
  setBadge.mockClear();
  vi.stubGlobal("Notification", TestNotification);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      focus: vi.fn(),
      desktopBridge: { getClientPlatform: () => "darwin", setNotificationBadge: setBadge },
    }),
  );
  vi.stubGlobal("document", { hasFocus: () => focused });
  setNotificationBadge(0);
  setBadge.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("showTestNotification", () => {
  it("adds one to the thread badge while in the background, then clears on focus", () => {
    setNotificationBadge(2);
    expect(showTestNotification(false)).toBe(true);
    expect(TestNotification.sent.map((notification) => notification.title)).toEqual([
      "T3 Code test notification",
    ]);

    focused = true;
    window.dispatchEvent(new Event("focus"));

    expect(badgeCounts()).toEqual([2, 3, 2]);
    expect(TestNotification.sent[0]?.close).toHaveBeenCalled();
  });

  it("keeps real thread notifications counted after the test clears", () => {
    showTestNotification(false);
    setNotificationBadge(1);
    TestNotification.sent[0]?.dispatchEvent(new Event("click"));

    expect(badgeCounts()).toEqual([1, 2, 1]);
  });

  it("leaves the badge alone when the app is already focused", () => {
    focused = true;
    showTestNotification(false);

    expect(setBadge).not.toHaveBeenCalled();
    expect(TestNotification.sent).toHaveLength(1);
  });
});
