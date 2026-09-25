import { useState } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open."
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
                  "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                );
                return;
              }
              setRequesting(true);
              try {
                const permission = await Notification.requestPermission();
                if (permission !== "granted") {
                  setPermissionMessage(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  );
                  return;
                }
              } catch {
                setPermissionMessage(
                  "Notifications are unavailable in this browser. Sound only is still available.",
                );
                return;
              } finally {
                setRequesting(false);
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
            <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const REMINDER_MINUTE_OPTIONS = [0, 1, 2, 5, 10, 15, 30, 60];

function reminderLabel(minutes: number) {
  if (minutes === 0) return "Off";
  return minutes === 1 ? "After 1 minute" : `After ${minutes} minutes`;
}

export function AttentionReminderSettings() {
  const minutes = useScopedSettings((settings) => settings.attentionReminderMinutes);
  const updateSettings = useUpdateScopedSettings();
  const options = REMINDER_MINUTE_OPTIONS.includes(minutes)
    ? REMINDER_MINUTE_OPTIONS
    : [...REMINDER_MINUTE_OPTIONS, minutes].toSorted((a, b) => a - b);

  return (
    <SettingsRow
      {...searchableSetting("attention-reminders")}
      description="Alert again when an approval or question is still unanswered after this long. Uses the thread notification and in-app settings above."
      control={
        <Select
          value={String(minutes)}
          onValueChange={(value) => {
            const next = Number(value);
            if (Number.isInteger(next)) updateSettings({ attentionReminderMinutes: next });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Unanswered reminders">
            <SelectValue>{reminderLabel(minutes)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map((option) => (
              <SelectItem key={option} hideIndicator value={String(option)}>
                {reminderLabel(option)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
