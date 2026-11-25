import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_ATTENTION_REMINDER_MINUTES } from "@t3tools/contracts/settings";
import { settleAsyncResult } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react-native";
import { Alert, Linking, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { runtime } from "../../lib/runtime";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "./components/SettingsSection";

const REMINDER_OPTIONS = [0, 2, 5, 10, 30];

/**
 * Local reminders for unanswered approvals and questions. They are scheduled
 * on this device, so they work without T3 Connect push delivery.
 */
export function AttentionReminderSettingsSection() {
  const gt = useGT();
  const reminderLabel = (minutes: number) =>
    minutes === 0
      ? gt("Off", { $context: "reminder delay option" })
      : gt("{count, plural, =1 {After 1 minute} other {After {count} minutes}}", {
          count: minutes,
        });
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const ready = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selected = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.attentionReminderMinutes ?? DEFAULT_ATTENTION_REMINDER_MINUTES)
    : null;
  const options =
    selected === null || REMINDER_OPTIONS.includes(selected)
      ? REMINDER_OPTIONS
      : [...REMINDER_OPTIONS, selected].sort((a, b) => a - b);

  const select = async (minutes: number) => {
    void savePreferences({ attentionReminderMinutes: minutes });
    if (minutes === 0) return;
    const permission = await settleAsyncResult(() =>
      runtime.runPromiseExit(requestAgentNotificationPermission),
    );
    if (permission._tag === "Success" && permission.value.type === "denied") {
      Alert.alert(
        gt("Notifications disabled"),
        gt("Allow notifications for {product} in system Settings to receive reminders.", {
          product: "T3 Code",
        }),
        [
          { text: gt("Cancel"), style: "cancel" },
          { text: gt("Open Settings"), onPress: () => void Linking.openSettings() },
        ],
      );
    }
  };

  return (
    <View className="gap-3">
      <SettingsSection title={gt("Unanswered reminders")}>
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
        {gt(
          "Notifies this device when an approval or question waits this long. Delivered even if the app is in the background; answering from any device cancels it once this app reconnects.",
        )}
      </Text>
    </View>
  );
}
