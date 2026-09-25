import type { ClientSettings } from "@t3tools/contracts/settings";

import completionUrl from "./assets/notification-completion.mp3";
import inputUrl from "./assets/notification-input.mp3";

type NotificationMode = ClientSettings["notificationMode"];
export const NOTIFICATION_MODE_LABELS = {
  off: "Off",
  notifications: "Notifications only",
  sound: "Sound only",
  "notifications-and-sound": "Notifications with sound",
} satisfies Record<NotificationMode, string>;

export function hasNotificationSound(mode: NotificationMode) {
  return mode === "sound" || mode === "notifications-and-sound";
}

export function hasDesktopNotifications(mode: NotificationMode) {
  return mode === "notifications" || mode === "notifications-and-sound";
}

let originalFavicon: HTMLLinkElement | undefined;
let badgeFavicon: HTMLLinkElement | undefined;
let threadBadgeCount = 0;
let testBadgeShown = false;

/** Badges the dock, taskbar, or favicon with the number of unread thread notifications. */
export function setNotificationBadge(count: number) {
  threadBadgeCount = count;
  applyNotificationBadge();
}

function applyNotificationBadge() {
  // A test badge only means something while the app is in the background.
  if (testBadgeShown && document.hasFocus()) testBadgeShown = false;
  const count = threadBadgeCount + (testBadgeShown ? 1 : 0);
  const bridge = window.desktopBridge;
  let image: string | null = null;
  if (count > 0 && (!bridge || bridge.getClientPlatform?.() === "win32")) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#e5484d";
      context.beginPath();
      context.arc(32, 32, 28, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.font = `600 ${count > 9 ? 30 : 40}px "Segoe UI", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(count > 9 ? "9+" : String(count), 32, 34);
      image = canvas.toDataURL("image/png");
    }
  }
  if (!bridge) {
    if (image) {
      if (!badgeFavicon) {
        originalFavicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? undefined;
        badgeFavicon = document.createElement("link");
        badgeFavicon.rel = "icon";
        badgeFavicon.type = "image/png";
        badgeFavicon.sizes.value = "64x64";
        originalFavicon?.remove();
        document.head.append(badgeFavicon);
      }
      badgeFavicon.href = image;
    } else if (badgeFavicon) {
      badgeFavicon.remove();
      badgeFavicon = undefined;
      if (originalFavicon) document.head.append(originalFavicon);
      originalFavicon = undefined;
    }
  }
  void bridge?.setNotificationBadge?.({ count, image }).catch(() => undefined);
}

export type NotificationPermissionCheck = "granted" | "denied" | "unsupported";

/** Asks for permission from a click, before a test notification is scheduled. */
export async function ensureNotificationPermission(): Promise<NotificationPermissionCheck> {
  if (typeof Notification === "undefined" || !window.isSecureContext) return "unsupported";
  try {
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    return permission === "granted" ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

/**
 * Presents a sample system notification and, while the app is in the
 * background, one extra badge. Both clear when the app regains focus.
 */
export function showTestNotification(withSound: boolean): boolean {
  let notification: Notification;
  try {
    notification = new Notification("T3 Code test notification", {
      body: "Notifications are working on this device.",
      tag: "t3code-test-notification",
      silent: true,
    });
  } catch {
    return false;
  }
  if (withSound) void playNotificationSound("completion", () => true);
  const clear = () => {
    window.removeEventListener("focus", clear);
    notification.close();
    if (!testBadgeShown) return;
    testBadgeShown = false;
    applyNotificationBadge();
  };
  notification.addEventListener("click", () => {
    window.focus();
    clear();
  });
  if (!document.hasFocus()) {
    testBadgeShown = true;
    applyNotificationBadge();
    window.addEventListener("focus", clear);
  }
  return true;
}

let audioContext: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();

/** Called from a gesture so browsers allow later background playback. */
export function unlockNotificationAudio() {
  audioContext ??= new AudioContext();
  void audioContext.resume().catch(() => undefined);
}

export async function playNotificationSound(
  kind: "completion" | "input",
  shouldPlay: () => boolean,
) {
  if (!audioContext || audioContext.state !== "running") return;
  const context = audioContext;
  const url = kind === "completion" ? completionUrl : inputUrl;
  try {
    let buffer = buffers.get(url);
    if (!buffer) {
      buffer = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data));
      buffers.set(url, buffer);
    }
    const decoded = await buffer;
    if (!shouldPlay() || context.state !== "running") return;
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.start();
  } catch {
    buffers.delete(url);
  }
}
