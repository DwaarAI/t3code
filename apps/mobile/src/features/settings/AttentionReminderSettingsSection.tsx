import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { DEFAULT_ATTENTION_REMINDER_MINUTES } from "@t3tools/contracts/settings";
import { settleAsyncResult } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { Alert, Linking, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { runtime } from "../../lib/runtime";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";
import { SettingsSection } from "./components/SettingsSection";

const REMINDER_OPTIONS = [0, 2, 5, 10, 30];

function reminderLabel(minutes: number) {
  if (minutes === 0) return "Off";
  return minutes === 1 ? "After 1 minute" : `After ${minutes} minutes`;
}

/**
 * Local reminders for unanswered approvals and questions. They are scheduled
 * on this device, so they work without T3 Connect push delivery.
 */
export function AttentionReminderSettingsSection() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selected = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.attentionReminderMinutes ?? DEFAULT_ATTENTION_REMINDER_MINUTES)
    : null;
  const options =
    selected === null || REMINDER_OPTIONS.includes(selected)
      ? REMINDER_OPTIONS
      : [...REMINDER_OPTIONS, selected].sort((a, b) => a - b);

  const select = async (minutes: number) => {
    savePreferences({ attentionReminderMinutes: minutes });
    if (minutes === 0) return;
    const permission = await settleAsyncResult(() =>
      runtime.runPromiseExit(requestAgentNotificationPermission),
    );
    if (permission._tag === "Success" && permission.value.type === "denied") {
      Alert.alert(
        "Notifications disabled",
        "Allow notifications for T3 Code in system Settings to receive reminders.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ],
      );
    }
  };

  return (
    <View className="gap-3">
      <SettingsSection title="Unanswered reminders">
        {options.map((minutes, index) => (
          <SettingsChoiceRow
            key={minutes}
            label={reminderLabel(minutes)}
            selected={selected === minutes}
            separated={index > 0}
            disabled={!ready}
            onPress={() => void select(minutes)}
          />
        ))}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Notifies this device when an approval or question waits this long. Delivered even if the app
        is in the background; answering from any device cancels it once this app reconnects.
      </Text>
    </View>
  );
}
