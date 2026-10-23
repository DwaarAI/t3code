import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const SOUND_SECONDS = 0.6;

const audio = { currentTime: 0, started: 0 };

class FakeAudioContext {
  state = "running";
  destination = {};
  get currentTime() {
    return audio.currentTime;
  }
  resume() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ duration: SOUND_SECONDS });
  }
  createBufferSource() {
    return {
      buffer: null,
      connect() {},
      start() {
        audio.started += 1;
      },
    };
  }
}

async function loadUnlocked() {
  const notifications = await import("./threadNotifications");
  notifications.unlockNotificationAudio();
  return notifications;
}

beforeEach(() => {
  vi.resetModules();
  audio.currentTime = 0;
  audio.started = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playNotificationSound", () => {
  it("plays one sound for threads that complete together", async () => {
    const { playNotificationSound } = await loadUnlocked();

    // All four are waiting on the first decode when the sound becomes playable.
    await Promise.all(
      Array.from({ length: 4 }, () => playNotificationSound("completion", () => true)),
    );

    expect(audio.started).toBe(1);
  });

  it("still plays an input alert over a completion sound", async () => {
    const { playNotificationSound } = await loadUnlocked();
    await playNotificationSound("completion", () => true);

    await playNotificationSound("input", () => true);

    expect(audio.started).toBe(2);
  });

  it("leaves the slot free when a sound is turned off before it plays", async () => {
    const { playNotificationSound } = await loadUnlocked();
    await playNotificationSound("completion", () => false);

    await playNotificationSound("completion", () => true);

    expect(audio.started).toBe(1);
  });
});

describe("showTestNotification", () => {
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
  });

  it("adds one to the thread badge while in the background, then clears on focus", async () => {
    const { setNotificationBadge, showTestNotification } = await import("./threadNotifications");
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

  it("keeps real thread notifications counted after the test clears", async () => {
    const { setNotificationBadge, showTestNotification } = await import("./threadNotifications");
    showTestNotification(false);
    setNotificationBadge(1);
    TestNotification.sent[0]?.dispatchEvent(new Event("click"));

    expect(badgeCounts()).toEqual([1, 2, 1]);
  });

  it("leaves the badge alone when the app is already focused", async () => {
    const { showTestNotification } = await import("./threadNotifications");
    focused = true;
    showTestNotification(false);

    expect(setBadge).not.toHaveBeenCalled();
    expect(TestNotification.sent).toHaveLength(1);
  });
});
