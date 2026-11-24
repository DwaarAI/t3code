import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import {
  ensureNotificationPermission,
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  showTestNotification,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        gt(
          "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open.",
        )
      }
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(
                  gt(
                    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                  ),
                );
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(
                  gt(
                    "Notifications are unavailable in this browser. Sound only is still available.",
                  ),
                );
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(
                  gt(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  ),
                );
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Thread notifications")}
          >
            <SelectValue>{m(NOTIFICATION_MODE_LABELS[mode])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {m(label)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const TEST_NOTIFICATION_DELAY_MS = 5_000;

function systemNotificationSettingsHint(gt: ReturnType<typeof useGT>) {
  const platform = window.desktopBridge?.getClientPlatform?.();
  if (platform === "darwin") {
    return gt("Allow T3 Code, including Badges, in System Settings → Notifications.");
  }
  if (platform === "win32") return gt("Allow T3 Code in Settings → System → Notifications.");
  if (platform === "linux") return gt("Check your desktop's notification settings.");
  return gt("Allow notifications for this site in your browser.");
}

/** Sends a sample alert after a short delay, so the app can be in the background. */
export function TestNotificationSettings() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const [status, setStatus] = useState<"idle" | "waiting">("idle");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <SettingsRow
      {...searchableSetting("test-notification")}
      description={
        message ??
        gt(
          "Sends a system notification in 5 seconds. Switch to another app to also see the badge on the app icon.",
        )
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={status === "waiting"}
          onClick={async () => {
            setMessage(null);
            // Audio and permission prompts only unlock from a click.
            if (hasNotificationSound(mode)) unlockNotificationAudio();
            const permission = await ensureNotificationPermission();
            if (permission === "unsupported") {
              setMessage(
                gt("System notifications need a supported browser over HTTPS, or the desktop app."),
              );
              return;
            }
            if (permission === "denied") {
              setMessage(
                gt("Notifications are blocked. {fix}", { fix: systemNotificationSettingsHint(gt) }),
              );
              return;
            }
            setStatus("waiting");
            setTimeout(() => {
              setStatus("idle");
              if (!showTestNotification(hasNotificationSound(mode))) {
                setMessage(gt("This browser refused to show the notification."));
                return;
              }
              setMessage(
                hasDesktopNotifications(mode)
                  ? gt("Sent. If nothing appeared: {fix}", {
                      fix: systemNotificationSettingsHint(gt),
                    })
                  : gt(
                      "Sent. Thread notifications are off, so threads will not alert until you turn them on above.",
                    ),
              );
            }, TEST_NOTIFICATION_DELAY_MS);
          }}
        >
          {status === "waiting" ? gt("Sending in 5 seconds…") : gt("Send test notification")}
        </Button>
      }
    />
  );
}

const REMINDER_MINUTE_OPTIONS = [0, 1, 2, 5, 10, 15, 30, 60];

function reminderLabel(minutes: number, gt: ReturnType<typeof useGT>) {
  if (minutes === 0) return gt("Off", { $context: "reminders are turned off" });
  return gt("{minutes, plural, =1 {After 1 minute} other {After {minutes} minutes}}", { minutes });
}

export function AttentionReminderSettings() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const minutes = useScopedSettings((settings) => settings.attentionReminderMinutes);
  const updateSettings = useUpdateScopedSettings();
  const options = REMINDER_MINUTE_OPTIONS.includes(minutes)
    ? REMINDER_MINUTE_OPTIONS
    : [...REMINDER_MINUTE_OPTIONS, minutes].toSorted((a, b) => a - b);

  return (
    <SettingsRow
      {...searchableSetting("attention-reminders")}
      description={gt(
        "Alert again when an approval or question is still unanswered after this long. Uses the thread notification and in-app settings above.",
      )}
      control={
        <Select
          value={String(minutes)}
          onValueChange={(value) => {
            const next = Number(value);
            if (Number.isInteger(next)) updateSettings({ attentionReminderMinutes: next });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Unanswered reminders")}
          >
            <SelectValue>{reminderLabel(minutes, gt)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem key={option} hideIndicator value={String(option)}>
                {reminderLabel(option, gt)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
