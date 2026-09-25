import type { EnvironmentId, OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";

/**
 * Reminders for threads blocked on the user (a pending approval or question).
 * Each client schedules its own: web/desktop with a timer, mobile with an OS
 * local notification, so a reminder still fires while the phone app sleeps.
 * The shell stream is the only signal for "handled"; a request answered from
 * any device drops the flag and every client cancels its reminder.
 */

export type AttentionReminderKind = "approval" | "input";

export const ATTENTION_REMINDER_ID_PREFIX = "t3-attention-reminder:";

export interface AttentionReminder {
  /** Stable while one request stays pending; a later turn asking again gets a new id. */
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly kind: AttentionReminderKind;
}

export type AttentionReminderThread = Pick<
  OrchestrationThreadShell,
  | "id"
  | "title"
  | "archivedAt"
  | "snoozedUntil"
  | "latestTurn"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
>;

export interface AttentionReminderEnvironment {
  readonly environmentId: EnvironmentId;
  /**
   * Only a live shell can say a request was handled. Cached or reconnecting
   * shells keep their existing reminders instead of cancelling on stale data.
   */
  readonly live: boolean;
  readonly threads: ReadonlyArray<AttentionReminderThread>;
}

export function threadAttentionReminder(
  environmentId: EnvironmentId,
  thread: AttentionReminderThread,
  nowMs: number,
): AttentionReminder | null {
  if (thread.archivedAt !== null) return null;
  // A snoozed thread was deliberately put away; it reminds again once the snooze ends.
  if (thread.snoozedUntil && Date.parse(thread.snoozedUntil) > nowMs) return null;
  const kind: AttentionReminderKind | null = thread.hasPendingApprovals
    ? "approval"
    : thread.hasPendingUserInput
      ? "input"
      : null;
  if (!kind) return null;
  return {
    id: `${ATTENTION_REMINDER_ID_PREFIX}${environmentId}:${thread.id}:${thread.latestTurn?.turnId ?? ""}:${kind}`,
    environmentId,
    threadId: thread.id,
    threadTitle: thread.title,
    kind,
  };
}

/**
 * Diffs what should be reminded about against what is already scheduled
 * (or already fired, so each pending request reminds once). Environments that
 * are gone cancel everything; environments that are not live change nothing.
 */
export function planAttentionReminders(input: {
  readonly environments: ReadonlyArray<AttentionReminderEnvironment>;
  readonly scheduled: ReadonlyMap<string, EnvironmentId>;
  readonly nowMs: number;
}): {
  readonly schedule: ReadonlyArray<AttentionReminder>;
  readonly cancel: ReadonlyArray<string>;
} {
  const wanted = new Map<string, AttentionReminder>();
  const known = new Map<EnvironmentId, boolean>();
  for (const environment of input.environments) {
    known.set(environment.environmentId, environment.live);
    if (!environment.live) continue;
    for (const thread of environment.threads) {
      const reminder = threadAttentionReminder(environment.environmentId, thread, input.nowMs);
      if (reminder) wanted.set(reminder.id, reminder);
    }
  }
  const schedule = [...wanted.values()].filter((reminder) => !input.scheduled.has(reminder.id));
  const cancel: string[] = [];
  for (const [id, environmentId] of input.scheduled) {
    const live = known.get(environmentId);
    if (live === undefined || (live && !wanted.has(id))) cancel.push(id);
  }
  return { schedule, cancel };
}

export function attentionReminderTitle(kind: AttentionReminderKind): string {
  return kind === "approval" ? "Still waiting for approval" : "Still waiting for your answer";
}
