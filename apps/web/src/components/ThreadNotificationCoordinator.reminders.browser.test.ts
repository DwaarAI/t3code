import type { AnyRouter } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, stubGlobal } from "../../test/render";

const state = vi.hoisted(() => ({
  reminderMinutes: 5,
  settingsListeners: new Set<() => void>(),
}));
vi.mock(import("../state/shell"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentShell: {
      ...actual.environmentShell,
      stateValueAtom: ((id: string) => shellAtom(id)) as never,
    },
  };
});
vi.mock(import("../state/presentation"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentSummaries: {
      ...actual.environmentSummaries,
      // Read lazily: the factory runs before this module's own bindings exist.
      get environmentIdsAtom() {
        return environmentIdsAtom as never;
      },
    },
  };
});
vi.mock(import("../state/threads"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentThreadShells: {
      ...actual.environmentThreadShells,
      pendingSubagentRequestsAtom: (() => noRequestsAtom) as never,
      get delegatedUnderParentAtom() {
        return noDelegatedAtom as never;
      },
    },
  };
});
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  subscribeClientSettings: ((listener: () => void) => {
    state.settingsListeners.add(listener);
    return () => state.settingsListeners.delete(listener);
  }) as never,
  getClientSettings: (() => ({
    notificationMode: "notifications",
    inAppNotificationsEnabled: false,
    attentionReminderMinutes: state.reminderMinutes,
  })) as never,
}));
vi.mock(import("../threadNotifications"), async (original) => ({
  ...(await original()),
  playNotificationSound: vi.fn(),
  unlockNotificationAudio: vi.fn(),
  setNotificationBadge: vi.fn(),
}));

import { startThreadNotifications } from "./ThreadNotificationCoordinator";

let registry: AtomRegistry.AtomRegistry;
const shellAtom = Atom.family((_id: string) => Atom.make<unknown>(null));
const environmentIdsAtom = Atom.make<ReadonlyArray<string>>([]);
const noRequestsAtom = Atom.make(new Map());
const noDelegatedAtom = Atom.make<ReadonlySet<string>>(new Set<string>());

class TestNotification extends EventTarget {
  static permission = "granted";
  static sent: TestNotification[] = [];
  close = vi.fn();
  get tag() {
    return this.options.tag ?? "";
  }
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    super();
    TestNotification.sent.push(this);
  }
}

const SHELL_NOW = DateTime.makeUnsafe("2026-09-13T09:00:00.000Z");
type Request = "input" | "approval" | null;

function threadShell(id: string, request: Request, subagent = false) {
  return {
    id,
    projectId: "project-1",
    title: id === "thread-1" ? "Fix the login form" : "Review the login form",
    providerInstanceId: "codex",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: subagent
      ? { rootThreadId: "thread-1", parentThreadId: "thread-1", relationshipToParent: "subagent" }
      : { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: subagent ? "mcp" : "web",
    latestRunId: "run-1",
    activeRunId: null,
    status: "running",
    lastErrorClass: null,
    pendingRuntimeRequest:
      request === "input"
        ? { id: `request-${id}`, kind: "user_input", createdAt: SHELL_NOW }
        : request === "approval"
          ? { id: `request-${id}`, kind: "command", createdAt: SHELL_NOW }
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

const shell = (threads: ReadonlyArray<unknown>, status = "live") => ({
  status,
  snapshot: Option.some({ threads }),
});

// The window is unfocused so every alert goes to a system notification.
function setup() {
  vi.clearAllMocks();
  state.reminderMinutes = 5;
  state.settingsListeners.clear();
  const stack = new AsyncDisposableStack();
  registry = AtomRegistry.make();
  const testRegistry = registry;
  stack.defer(() => testRegistry.dispose());
  registry.set(environmentIdsAtom, ["env-1"]);
  registry.set(shellAtom("env-1"), shell([threadShell("thread-1", null)]));
  TestNotification.sent = [];
  stack.use(fakeTimers());
  stack.use(stubGlobal("Notification", TestNotification));
  stack.use(vi.spyOn(document, "hasFocus").mockImplementation(() => false));
  const router = {
    state: { matches: [{ params: {} }] },
    navigate: vi.fn(),
    subscribe: () => () => {},
  } as unknown as AnyRouter;
  return {
    start: () => {
      stack.defer(startThreadNotifications(testRegistry, router));
    },
    set: (threads: ReadonlyArray<unknown>, status?: string) =>
      testRegistry.set(shellAtom("env-1"), shell(threads, status)),
    changeSettings: () => {
      for (const listener of state.settingsListeners) listener();
    },
    wait: (minutes: number) => vi.advanceTimersByTime(minutes * 60_000),
    titles: () => TestNotification.sent.map((sent) => sent.title),
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

describe("unanswered request reminders", () => {
  it("reminds once after the delay while the approval stays pending", async () => {
    await using app = setup();
    app.start();
    app.set([threadShell("thread-1", "approval")]);
    expect(app.titles()).toEqual(["Approval needed"]);
    app.wait(4);
    expect(app.titles()).toHaveLength(1);
    app.wait(1);
    expect(app.titles()).toEqual(["Approval needed", "Still waiting for approval"]);
    expect(TestNotification.sent[1]!.options.body).toBe("Fix the login form");
    app.set([threadShell("thread-1", "approval")]);
    app.wait(30);
    expect(app.titles()).toHaveLength(2);
  });

  it("reminds about requests already pending when the app starts", async () => {
    await using app = setup();
    app.set([threadShell("thread-1", "input")]);
    app.start();
    app.wait(5);
    expect(app.titles()).toContain("Still waiting for your answer");
  });

  it("reminds on the parent while its delegated subagent waits for approval", async () => {
    await using app = setup();
    app.set([threadShell("thread-1", null), threadShell("child-1", "approval", true)]);
    app.start();
    app.wait(5);
    const reminder = TestNotification.sent.find(
      (sent) => sent.title === "Still waiting for approval",
    );
    expect(reminder?.options.body).toBe("Fix the login form");
  });

  it("cancels the reminder once the request is answered", async () => {
    await using app = setup();
    app.set([threadShell("thread-1", "input")]);
    app.start();
    app.wait(2);
    app.set([threadShell("thread-1", null)]);
    app.wait(10);
    expect(app.titles()).not.toContain("Still waiting for your answer");
  });

  it("waits for a live connection, since another device may have answered", async () => {
    await using app = setup();
    app.set([threadShell("thread-1", "input")]);
    app.start();
    app.set([threadShell("thread-1", "input")], "cached");
    app.wait(5);
    expect(app.titles()).not.toContain("Still waiting for your answer");
    app.set([threadShell("thread-1", "input")]);
    app.wait(5);
    expect(app.titles().filter((title) => title === "Still waiting for your answer")).toHaveLength(
      1,
    );
  });

  it("does nothing when reminders are off", async () => {
    await using app = setup();
    state.reminderMinutes = 0;
    app.set([threadShell("thread-1", "approval")]);
    app.start();
    app.wait(60);
    expect(app.titles()).not.toContain("Still waiting for approval");
  });

  it("restarts pending reminders with a new delay", async () => {
    await using app = setup();
    app.set([threadShell("thread-1", "approval")]);
    app.start();
    app.wait(4);
    state.reminderMinutes = 10;
    app.changeSettings();
    app.wait(9);
    expect(app.titles()).not.toContain("Still waiting for approval");
    app.wait(1);
    expect(app.titles()).toContain("Still waiting for approval");
  });
});
