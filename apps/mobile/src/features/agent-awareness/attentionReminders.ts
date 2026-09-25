import { useAtomValue } from "@effect/atom-react";
import {
  ATTENTION_REMINDER_ID_PREFIX,
  type AttentionReminderEnvironment,
  attentionReminderTitle,
  planAttentionReminders,
  threadAttentionReminder,
} from "@t3tools/client-runtime/attention-reminders";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_ATTENTION_REMINDER_MINUTES } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { environmentCatalog } from "../../connection/catalog";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentShell } from "../../state/shell";

const CHANNEL_ID = "agent-alerts";

/**
 * Only the threads that need a reminder, so the worker re-renders when a
 * request appears or is handled rather than on every shell update. `null`
 * until the catalog loads: an empty catalog would cancel every reminder.
 */
let previous: { key: string; environments: ReadonlyArray<AttentionReminderEnvironment> } | null =
  null;
const attentionReminderEnvironmentsAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  if (!catalog.isReady) return null;
  const nowMs = Date.now();
  const environments: AttentionReminderEnvironment[] = [];
  const keyParts: string[] = [];
  for (const environmentId of enabledEnvironmentIds(catalog)) {
    const state = get(environmentShell.stateValueAtom(environmentId));
    const live = state.status === "live" && Option.isSome(state.snapshot);
    const threads = Option.isSome(state.snapshot)
      ? state.snapshot.value.threads.filter(
          (thread) => threadAttentionReminder(environmentId, thread, nowMs) !== null,
        )
      : [];
    environments.push({ environmentId, live, threads: live ? threads : [] });
    keyParts.push(`${environmentId}:${live}`);
    if (live) {
      for (const thread of threads) {
        keyParts.push(threadAttentionReminder(environmentId, thread, nowMs)!.id);
      }
    }
  }
  const key = keyParts.join("|");
  if (previous?.key !== key) previous = { key, environments };
  return previous.environments;
}).pipe(Atom.withLabel("mobile:attention-reminder-environments"));

async function scheduledAttentionReminders(): Promise<Map<string, EnvironmentId>> {
  const [scheduled, presented] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync(),
    Notifications.getPresentedNotificationsAsync(),
  ]);
  const reminders = new Map<string, EnvironmentId>();
  for (const request of [...scheduled, ...presented.map((notification) => notification.request)]) {
    const environmentId = request.content.data?.environmentId;
    if (
      request.identifier.startsWith(ATTENTION_REMINDER_ID_PREFIX) &&
      typeof environmentId === "string"
    ) {
      reminders.set(request.identifier, environmentId as EnvironmentId);
    }
  }
  return reminders;
}

async function cancelAttentionReminder(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
  // A reminder that already fired is dismissed once the request is handled.
  await Notifications.dismissNotificationAsync(id);
}

/**
 * Schedules an OS notification for each thread waiting on an approval or
 * answer. The OS delivers it after the configured delay even if the app is
 * backgrounded or closed; while the app is connected, a request handled on
 * any device cancels it. Scheduled reminders survive app restarts, so the
 * delay is not restarted on launch.
 */
export function useAttentionReminderNotifications(): void {
  const environments = useAtomValue(attentionReminderEnvironmentsAtom);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const minutes = AsyncResult.isSuccess(preferences)
    ? (preferences.value.attentionReminderMinutes ?? DEFAULT_ATTENTION_REMINDER_MINUTES)
    : null;
  const tracked = useRef<Map<string, EnvironmentId> | null>(null);
  const queue = useRef(Promise.resolve());
  const appliedMinutes = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return;
    if (environments === null || minutes === null) return;
    // Reconciles run one at a time so a quick answer cannot race its own scheduling.
    queue.current = queue.current
      .then(async () => {
        if (tracked.current === null) {
          tracked.current = await scheduledAttentionReminders();
          if (Platform.OS === "android") {
            await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
              name: "Agent alerts",
              importance: Notifications.AndroidImportance.HIGH,
            });
          }
        }
        const reminders = tracked.current;
        // Turning reminders off clears them; a new delay restarts them from now.
        if (minutes <= 0 || (appliedMinutes.current ?? minutes) !== minutes) {
          await Promise.all([...reminders.keys()].map(cancelAttentionReminder));
          reminders.clear();
        }
        appliedMinutes.current = minutes;
        if (minutes <= 0) return;
        const plan = planAttentionReminders({
          environments,
          scheduled: reminders,
          nowMs: Date.now(),
        });
        for (const id of plan.cancel) {
          reminders.delete(id);
          await cancelAttentionReminder(id);
        }
        const { granted } = await Notifications.getPermissionsAsync();
        if (!granted) return;
        for (const reminder of plan.schedule) {
          reminders.set(reminder.id, reminder.environmentId);
          await Notifications.scheduleNotificationAsync({
            identifier: reminder.id,
            content: {
              title: attentionReminderTitle(reminder.kind),
              body: reminder.threadTitle,
              data: {
                environmentId: reminder.environmentId,
                threadId: reminder.threadId,
              },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: minutes * 60,
              channelId: CHANNEL_ID,
            },
          });
        }
      })
      .catch((error: unknown) => {
        console.warn("Could not update unanswered request reminders.", error);
      });
  }, [environments, minutes]);
}
