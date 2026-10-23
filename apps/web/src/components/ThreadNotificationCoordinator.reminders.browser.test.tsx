import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render, stubGlobal, type Screen } from "../../test/render";

const state = vi.hoisted(() => ({
  reminderMinutes: 5,
  live: true,
  input: false,
  approval: false,
  delegatedChild: null as "running" | "approval" | null,
  navigate: vi.fn(),
  notification: vi.fn(function (_title: string, options: NotificationOptions) {
    return Object.assign(new EventTarget(), { tag: options.tag, close: vi.fn() });
  }),
}));

const SHELL_NOW = DateTime.makeUnsafe("2026-09-13T09:00:00.000Z");

function mockThreadShell() {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Fix the login form",
    providerInstanceId: "codex",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: "thread-1", parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: "run-1",
    activeRunId: null,
    status: "running",
    lastErrorClass: null,
    pendingRuntimeRequest: state.input
      ? { id: "request-1", kind: "user_input", createdAt: SHELL_NOW }
      : state.approval
        ? { id: "request-1", kind: "command", createdAt: SHELL_NOW }
        : null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: SHELL_NOW,
    updatedAt: SHELL_NOW,
    latestRunRequestedAt: SHELL_NOW,
    latestRunStartedAt: SHELL_NOW,
    latestRunCompletedAt: undefined,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

// The parent keeps its identity across renders so only the child's request changes.
let stableParent: ReturnType<typeof mockThreadShell> | null = null;
function mockThreads() {
  if (state.delegatedChild === null) return [mockThreadShell()];
  stableParent ??= mockThreadShell();
  const child = {
    ...mockThreadShell(),
    id: "child-1",
    title: "Review the login form",
    creationSource: "mcp",
    lineage: {
      rootThreadId: "thread-1",
      parentThreadId: "thread-1",
      relationshipToParent: "subagent",
    },
    pendingRuntimeRequest:
      state.delegatedChild === "approval"
        ? { id: "request-2", kind: "command", createdAt: SHELL_NOW }
        : null,
  };
  return [stableParent, child];
}

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => ({
    status: state.live ? "live" : "disconnected",
    snapshot: Option.some({ threads: mockThreads() }),
  })) as never,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
  useParams: (() => ({ environmentId: "env-1", threadId: "other-thread" })) as never,
}));
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useClientSettings: ((
    select: (
      settings: Pick<
        ClientSettings,
        "notificationMode" | "inAppNotificationsEnabled" | "attentionReminderMinutes"
      >,
    ) => unknown,
  ) =>
    select({
      notificationMode: "notifications",
      inAppNotificationsEnabled: true,
      attentionReminderMinutes: state.reminderMinutes,
    })) as never,
  getClientSettings: (() => ({ notificationMode: "notifications" })) as never,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentIds: (() => ["env-1"]) as never,
}));
vi.mock(import("../threadNotifications"), async (original) => ({
  ...(await original()),
  playNotificationSound: vi.fn(),
  unlockNotificationAudio: vi.fn(),
  setNotificationBadge: vi.fn(),
}));

import { threadNotificationTag } from "../threadNotifications";
import { ThreadNotificationCoordinator } from "./ThreadNotificationCoordinator";

const THREAD_TAG = threadNotificationTag("env-1" as EnvironmentId, "thread-1" as ThreadId);

// The window is unfocused so every alert goes to a system notification.
function setup() {
  vi.clearAllMocks();
  Object.assign(state, {
    reminderMinutes: 5,
    live: true,
    input: false,
    approval: false,
    delegatedChild: null,
  });
  stableParent = null;
  const stack = new AsyncDisposableStack();
  stack.use(fakeTimers());
  stack.use(
    stubGlobal("Notification", Object.assign(state.notification, { permission: "granted" })),
  );
  stack.use(vi.spyOn(document, "hasFocus").mockImplementation(() => false));
  let screen: Screen | undefined;
  return {
    async render() {
      if (screen) await screen.rerender(<ThreadNotificationCoordinator />);
      else screen = stack.use(await render(<ThreadNotificationCoordinator />));
    },
    wait: (minutes: number) => act(() => vi.advanceTimersByTime(minutes * 60_000)),
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

describe("unanswered request reminders", () => {
  it("reminds once after the delay while the approval stays pending", async () => {
    await using app = setup();
    await app.render();
    state.approval = true;
    await app.render();
    expect(state.notification).toHaveBeenCalledTimes(1);
    await app.wait(4);
    expect(state.notification).toHaveBeenCalledTimes(1);
    await app.wait(1);
    expect(state.notification).toHaveBeenCalledTimes(2);
    expect(state.notification).toHaveBeenLastCalledWith("Still waiting for approval", {
      body: "Fix the login form",
      tag: THREAD_TAG,
      silent: true,
    });
    await app.render();
    await app.wait(30);
    expect(state.notification).toHaveBeenCalledTimes(2);
  });

  it("reminds about requests already pending when the app starts", async () => {
    await using app = setup();
    state.input = true;
    await app.render();
    expect(state.notification).not.toHaveBeenCalled();
    await app.wait(5);
    expect(state.notification).toHaveBeenCalledWith("Still waiting for your answer", {
      body: "Fix the login form",
      tag: THREAD_TAG,
      silent: true,
    });
  });

  it("reminds on the parent while its delegated subagent waits for approval", async () => {
    await using app = setup();
    state.delegatedChild = "approval";
    await app.render();
    await app.wait(5);
    expect(state.notification).toHaveBeenCalledWith("Still waiting for approval", {
      body: "Fix the login form",
      tag: THREAD_TAG,
      silent: true,
    });
  });

  it("cancels the reminder once the request is answered", async () => {
    await using app = setup();
    state.input = true;
    await app.render();
    await app.wait(2);
    state.input = false;
    await app.render();
    await app.wait(10);
    expect(state.notification).not.toHaveBeenCalled();
  });

  it("waits for a live connection, since another device may have answered", async () => {
    await using app = setup();
    state.input = true;
    await app.render();
    state.live = false;
    await app.render();
    await app.wait(5);
    expect(state.notification).not.toHaveBeenCalled();
    state.live = true;
    await app.render();
    await app.wait(5);
    expect(state.notification).toHaveBeenCalledTimes(1);
  });

  it("does nothing when reminders are off", async () => {
    await using app = setup();
    state.reminderMinutes = 0;
    state.approval = true;
    await app.render();
    await app.wait(60);
    expect(state.notification).not.toHaveBeenCalled();
  });

  it("restarts pending reminders with a new delay", async () => {
    await using app = setup();
    state.approval = true;
    await app.render();
    await app.wait(4);
    state.reminderMinutes = 10;
    await app.render();
    await app.wait(9);
    expect(state.notification).not.toHaveBeenCalled();
    await app.wait(1);
    expect(state.notification).toHaveBeenCalledTimes(1);
  });
});
