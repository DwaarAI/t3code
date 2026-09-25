import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  attentionReminderTitle,
  planAttentionReminders,
} from "@t3tools/client-runtime/attention-reminders";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  unlockNotificationAudio,
} from "../threadNotifications";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { toastManager } from "./ui/toast";

export function ThreadNotificationCoordinator() {
  const { environments } = useEnvironments();
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const onNotification = useCallback((environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
    setNotificationBadge(pending.current.size);
  }, []);

  useEffect(() => {
    const activeIds = new Set(environments.map(({ environmentId }) => environmentId));
    const count = pending.current.size;
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (activeIds.has(environmentId)) continue;
      notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [environments]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
      setNotificationBadge(0);
    };
    clear();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  if (mode === "off" && !inAppNotificationsEnabled) return null;

  return environments.map((environment) => (
    <EnvironmentNotifications
      key={environment.environmentId}
      environmentId={environment.environmentId}
      onNotification={onNotification}
    />
  ));
}

type NotificationTone = "completion" | "approval" | "failed" | "input";

interface PresentContext {
  readonly environmentId: EnvironmentId;
  readonly activeEnvironmentId: string | undefined;
  readonly activeThreadId: string | undefined;
  readonly mode: ClientSettings["notificationMode"];
  readonly inAppNotificationsEnabled: boolean;
  readonly navigate: ReturnType<typeof useNavigate>;
  readonly onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}

/** Sound, then a toast while focused on another thread, else a system notification. */
function presentThreadNotification(
  context: PresentContext,
  alert: { threadId: ThreadId; threadTitle: string; title: string; tone: NotificationTone },
) {
  const { environmentId, mode, navigate } = context;
  const openThread = () =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: alert.threadId },
    });
  if (hasNotificationSound(mode)) {
    void playNotificationSound(alert.tone === "completion" ? "completion" : "input", () =>
      hasNotificationSound(getClientSettings().notificationMode),
    );
  }
  if (
    context.inAppNotificationsEnabled &&
    document.visibilityState === "visible" &&
    document.hasFocus() &&
    (context.activeEnvironmentId !== environmentId || context.activeThreadId !== alert.threadId)
  ) {
    const toastId = toastManager.add({
      type: alert.tone === "completion" ? "success" : alert.tone === "failed" ? "error" : "warning",
      title: alert.title,
      description: alert.threadTitle,
      data: {
        hideCopyButton: true,
        leadingIcon:
          alert.tone === "completion" ? (
            <CircleCheckIcon
              aria-hidden
              className="size-4 text-emerald-700 dark:text-emerald-300"
            />
          ) : alert.tone === "approval" ? (
            <ShieldQuestionIcon aria-hidden className="size-4 text-amber-700 dark:text-amber-300" />
          ) : alert.tone === "failed" ? (
            <CircleAlertIcon aria-hidden className="size-4 text-red-700 dark:text-red-300" />
          ) : (
            <MessageCircleQuestionIcon
              aria-hidden
              className="size-4 text-indigo-600 dark:text-indigo-300"
            />
          ),
      },
      actionProps: {
        children: "Open thread",
        onClick: () => {
          toastManager.close(toastId);
          openThread();
        },
      },
    });
    return;
  }
  if (
    !hasDesktopNotifications(mode) ||
    (document.visibilityState === "visible" && document.hasFocus()) ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return;
  try {
    const notification = new Notification(alert.title, {
      body: alert.threadTitle,
      tag: `${environmentId}:${alert.threadId}`,
      silent: true,
    });
    context.onNotification(environmentId, notification);
    notification.addEventListener("click", () => {
      notification.close();
      window.focus();
      openThread();
    });
  } catch {
    // Some browsers expose Notification but reject desktop presentation.
  }
}

function EnvironmentNotifications({
  environmentId,
  onNotification,
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const reminderMinutes = useClientSettings((settings) => settings.attentionReminderMinutes);
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const previous = useRef(
    new Map<ThreadId, { attention: string | null; completion: number | null }>(),
  );
  // Reminder timers fire long after they are scheduled; they present with current values.
  const latest = useRef<{ context: PresentContext; live: boolean } | null>(null);
  useEffect(() => {
    latest.current = {
      context: {
        environmentId,
        activeEnvironmentId,
        activeThreadId,
        mode,
        inAppNotificationsEnabled,
        navigate,
        onNotification,
      },
      live: shell.status === "live",
    };
  });
  const reminders = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const reminderDelay = useRef(reminderMinutes);

  useEffect(() => {
    const timers = reminders.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    // Turning reminders off clears them; a new delay restarts them from now.
    if (reminderMinutes <= 0 || reminderDelay.current !== reminderMinutes) {
      for (const timer of reminders.current.values()) clearTimeout(timer);
      reminders.current.clear();
      reminderDelay.current = reminderMinutes;
    }
    if (reminderMinutes <= 0) return;
    const live = shell.status === "live" && Option.isSome(shell.snapshot);
    const plan = planAttentionReminders({
      environments: [
        {
          environmentId,
          live,
          threads: live && Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : [],
        },
      ],
      scheduled: new Map([...reminders.current.keys()].map((id) => [id, environmentId])),
      nowMs: Date.now(),
    });
    for (const id of plan.cancel) {
      clearTimeout(reminders.current.get(id));
      reminders.current.delete(id);
    }
    for (const reminder of plan.schedule) {
      // The id stays after firing so one pending request reminds once.
      const timer = setTimeout(() => {
        // Disconnected: the request may already be handled elsewhere. Forget it
        // so a reconnect that still shows it pending starts a fresh delay.
        if (!latest.current?.live) {
          reminders.current.delete(reminder.id);
          return;
        }
        presentThreadNotification(latest.current.context, {
          threadId: reminder.threadId,
          threadTitle: reminder.threadTitle,
          title: attentionReminderTitle(reminder.kind),
          tone: reminder.kind,
        });
      }, reminderMinutes * 60_000);
      reminders.current.set(reminder.id, timer);
    }
  }, [environmentId, reminderMinutes, shell]);

  useEffect(() => {
    if (shell.status !== "live" || Option.isNone(shell.snapshot)) {
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, { attention: string | null; completion: number | null }>();
    for (const thread of shell.snapshot.value.threads) {
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestTurn?.state === "error") status = "failed";
      const prior = previous.current.get(thread.id);
      const attention =
        status === "input" || status === "approval" || status === "failed"
          ? `${thread.latestTurn?.turnId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestTurn?.completedAt ?? "");
      const completion =
        status === "ready" &&
        thread.latestTurn?.state === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { attention, completion });
      if (!prior || thread.archivedAt !== null) continue;
      const kind =
        attention && attention !== prior.attention
          ? "input"
          : completion !== null && (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind) continue;
      const tone: NotificationTone =
        kind === "completion"
          ? "completion"
          : status === "approval" || status === "failed"
            ? status
            : "input";
      presentThreadNotification(
        {
          environmentId,
          activeEnvironmentId,
          activeThreadId,
          mode,
          inAppNotificationsEnabled,
          navigate,
          onNotification,
        },
        {
          threadId: thread.id,
          threadTitle: thread.title,
          tone,
          title:
            tone === "completion"
              ? "Thread completed"
              : tone === "approval"
                ? "Approval needed"
                : tone === "failed"
                  ? "Thread failed"
                  : "Input needed",
        },
      );
    }
    previous.current = next;
  }, [
    activeEnvironmentId,
    activeThreadId,
    environmentId,
    inAppNotificationsEnabled,
    mode,
    navigate,
    onNotification,
    shell,
  ]);

  return null;
}
