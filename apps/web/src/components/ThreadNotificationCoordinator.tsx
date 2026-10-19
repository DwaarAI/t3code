import {
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { pendingSubagentRequestsByThread } from "@t3tools/client-runtime/state/threads";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  attentionReminderTitle,
  planAttentionReminders,
} from "@t3tools/client-runtime/attention-reminders";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironmentIds } from "../state/environments";
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
  const environmentIds = useEnvironmentIds();
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const onNotification = (environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
    setNotificationBadge(pending.current.size);
  };

  useEffect(() => {
    const activeIds = new Set(environmentIds);
    const count = pending.current.size;
    for (const [tag, entry] of pending.current) {
      if (activeIds.has(entry.environmentId)) continue;
      entry.notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [environmentIds]);

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

  return environmentIds.map((environmentId) => (
    <EnvironmentNotifications
      key={environmentId}
      environmentId={environmentId}
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
            <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
          ) : alert.tone === "approval" ? (
            <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
          ) : alert.tone === "failed" ? (
            <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
          ) : (
            <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
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

interface NotificationState {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly attention: string | null;
  readonly completion: number | null;
}

function EnvironmentNotifications({
  environmentId,
  onNotification,
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const threads =
    shell.status === "live" && Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const reminderMinutes = useClientSettings((settings) => settings.attentionReminderMinutes);
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const previous = useRef(new Map<ThreadId, NotificationState>());
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
      live: threads !== null,
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
    const plan = planAttentionReminders({
      environments: [{ environmentId, live: threads !== null, threads: threads ?? [] }],
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
  }, [environmentId, reminderMinutes, threads]);

  useEffect(() => {
    if (threads === null) {
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, NotificationState>();
    const subagentRequests = pendingSubagentRequestsByThread(threads);
    for (const rawThread of threads) {
      if (rawThread.lineage.relationshipToParent === "subagent") continue;
      const prior = previous.current.get(rawThread.id);
      const subagentRequest = subagentRequests.get(rawThread.id) ?? null;
      if (prior?.raw === rawThread && prior.subagentRequest === subagentRequest) {
        next.set(rawThread.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, rawThread, subagentRequest);
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestRun?.status === "failed") status = "failed";
      const attention =
        status === "input" || status === "approval" || status === "failed" || status === "limited"
          ? `${thread.latestRun?.runId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      const completion =
        status === "ready" &&
        thread.latestRun?.status === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { raw: rawThread, subagentRequest, attention, completion });
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
                : status === "limited"
                  ? "Usage limit reached"
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
    threads,
  ]);

  return null;
}
