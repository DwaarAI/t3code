import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import type { PendingSubagentRequest } from "./state/models.ts";
import { pendingSubagentRequestsByThread } from "./state/threadShell.ts";

/**
 * Reminders for threads blocked on the user. Each client schedules its own (mobile as an OS
 * notification, so it fires while the app sleeps). The shell stream is the only "handled"
 * signal: a request answered on any device drops the flag and every client cancels.
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
  OrchestrationV2ThreadShell,
  | "id"
  | "title"
  | "archivedAt"
  | "snoozedUntil"
  | "lineage"
  | "latestRunId"
  | "pendingRuntimeRequest"
>;

export interface AttentionReminderEnvironment {
  readonly environmentId: EnvironmentId;
  /**
   * Only a live shell can say a request was handled. Cached or reconnecting
   * shells keep their existing reminders instead of cancelling on stale data.
   */
  readonly live: boolean;
  /** Every thread of the environment, so subagent requests reach their parent. */
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
}

/**
 * The reminder one thread needs right now. Subagents never remind themselves:
 * their requests surface on the parent through `subagentRequest`.
 */
export function threadAttentionReminder(
  environmentId: EnvironmentId,
  thread: AttentionReminderThread,
  nowMs: number,
  subagentRequest: PendingSubagentRequest | null = null,
): AttentionReminder | null {
  if (thread.archivedAt !== null) return null;
  if (thread.lineage.relationshipToParent === "subagent") return null;
  // A snoozed thread was deliberately put away; it reminds again once the snooze ends.
  if (thread.snoozedUntil && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs) return null;
  const request = thread.pendingRuntimeRequest;
  const ownKind: AttentionReminderKind | null =
    request === null || request.kind === "auth_refresh"
      ? null
      : request.kind === "user_input"
        ? "input"
        : "approval";
  const kind: AttentionReminderKind | null =
    ownKind ??
    (subagentRequest === "approval"
      ? "approval"
      : subagentRequest === "user_input"
        ? "input"
        : null);
  if (!kind) return null;
  // Keyed by the request itself, so a later request on the same thread reminds again.
  const requestKey = ownKind && request ? request.id : `subagent:${thread.latestRunId ?? ""}`;
  return {
    id: `${ATTENTION_REMINDER_ID_PREFIX}${environmentId}:${thread.id}:${requestKey}:${kind}`,
    environmentId,
    threadId: thread.id,
    threadTitle: thread.title,
    kind,
  };
}

export function environmentAttentionReminders(
  environmentId: EnvironmentId,
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  nowMs: number,
): ReadonlyArray<AttentionReminder> {
  const subagentRequests = pendingSubagentRequestsByThread(threads);
  const reminders: AttentionReminder[] = [];
  for (const thread of threads) {
    const subagentRequest = subagentRequests.get(thread.id) ?? null;
    const reminder = threadAttentionReminder(
      environmentId,
      thread,
      nowMs,
      // A user-only card still waits on the user, so it reminds like any question.
      subagentRequest === "user_only_input" ? "user_input" : subagentRequest,
    );
    if (reminder) reminders.push(reminder);
  }
  return reminders;
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
    for (const reminder of environmentAttentionReminders(
      environment.environmentId,
      environment.threads,
      input.nowMs,
    )) {
      wanted.set(reminder.id, reminder);
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

export function attentionReminderTitle(
  kind: AttentionReminderKind,
  resolve: MFunctionType = mFallback,
): string {
  return kind === "approval"
    ? resolve(msg("Still waiting for approval"))
    : resolve(msg("Still waiting for your answer"));
}
