import {
  type AttentionReminderEnvironment,
  environmentAttentionReminders,
} from "@t3tools/client-runtime/attention-reminders";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

export interface AttentionReminderSelection {
  readonly key: string;
  readonly environments: ReadonlyArray<AttentionReminderEnvironment>;
}

/**
 * The environments the reminder worker reconciles. Returns `previous` while the
 * set of pending reminders is unchanged, so ordinary shell updates do not
 * re-run the worker. Only a live shell hands over threads: a cached or
 * reconnecting one keeps its scheduled reminders.
 */
export function selectAttentionReminderEnvironments(
  shells: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly state: EnvironmentShellState;
  }>,
  nowMs: number,
  previous: AttentionReminderSelection | null,
): AttentionReminderSelection {
  const environments: AttentionReminderEnvironment[] = [];
  const keyParts: string[] = [];
  for (const { environmentId, state } of shells) {
    const snapshot = state.status === "live" ? Option.getOrNull(state.snapshot) : null;
    const threads = snapshot?.threads ?? [];
    environments.push({ environmentId, live: snapshot !== null, threads });
    keyParts.push(`${environmentId}:${snapshot !== null}`);
    for (const reminder of environmentAttentionReminders(environmentId, threads, nowMs)) {
      keyParts.push(reminder.id);
    }
  }
  const key = keyParts.join("|");
  return previous?.key === key ? previous : { key, environments };
}
