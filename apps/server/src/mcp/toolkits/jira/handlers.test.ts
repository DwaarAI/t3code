import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type Folder,
  type JiraComment,
  type JiraIssueSummary,
  type Project,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as FolderService from "../../../folder/FolderService.ts";
import * as JiraService from "../../../jira/JiraService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as JiraHandlers from "./handlers.ts";
import { findTransition } from "./handlers.ts";
import { JiraToolkit } from "./tools.ts";

const FOLDERS_DIR = "/home/me/.t3/folders";

const ticket = (key: string): JiraIssueSummary => ({
  key,
  summary: `Ticket ${key}`,
  status: "To Do",
  statusCategory: "new",
  issueType: "Task",
  priority: null,
  assignee: null,
  parentKey: null,
  url: `https://acme.atlassian.net/browse/${key}`,
});

const invocation = (options: {
  readonly capabilities: ReadonlyArray<McpInvocationContext.McpCapability>;
  readonly readOnlyClient?: boolean;
}): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  requestNamespace: "session-1",
  thread: options.readOnlyClient
    ? undefined
    : {
        threadId: ThreadId.make("thread-1"),
        providerSessionId: "session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
  client: options.readOnlyClient
    ? { sessionId: "client-1", label: "Reader", access: "read-only" }
    : undefined,
  capabilities: new Set(options.capabilities),
  issuedAt: 1,
});

const makeHarness = Effect.gen(function* () {
  const comments: Array<{ readonly key: string; readonly body: string }> = [];
  const layerDependencies = Layer.mergeAll(
    // The testkit's calling thread runs in this project, the folder session's root.
    Layer.mock(ProjectService.ProjectService)({
      getById: (projectId) =>
        Effect.succeed(
          Option.some({ id: projectId, workspaceRoot: `${FOLDERS_DIR}/checkout` } as Project),
        ),
    }),
    Layer.mock(FolderService.FolderService)({
      list: () =>
        Effect.succeed({
          foldersDir: FOLDERS_DIR,
          guidesDir: "/home/me/.t3/guides",
          folders: [
            { slug: "checkout", name: "Checkout", jiraIssues: ["DW-1"] } as unknown as Folder,
          ],
        }),
    }),
    Layer.mock(JiraService.JiraService)({
      summaries: (keys) => Effect.succeed(keys.map(ticket)),
      addComment: (key, body) =>
        Effect.sync(() => {
          comments.push({ key, body });
          return { id: "c-1", author: null, body, created: "", updated: "" } as JiraComment;
        }),
    }),
    Layer.succeed(ServerConfig.ServerConfig, {
      foldersDir: FOLDERS_DIR,
    } as unknown as ServerConfig.ServerConfig["Service"]),
    McpToolAccessTestkit.liveThreadsLayer,
  );
  const toolkit = yield* JiraToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(JiraHandlers.layer).pipe(Layer.provide(layerDependencies)),
    ),
  );
  const call = <Name extends keyof typeof JiraToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    scope: McpInvocationContext.McpInvocationScope,
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((chunk) => chunk.at(-1)!.result as Tool.Success<(typeof JiraToolkit.tools)[Name]>),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
      Effect.provide(layerDependencies),
    );
  return { comments, call };
});

describe("Jira toolkit handlers", () => {
  it.effect("refuses a credential without the jira capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const error = yield* harness
        .call(
          "comment_on_jira_ticket",
          { key: "DW-1", body: "Done" },
          invocation({ capabilities: ["preview"] }),
        )
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "McpCapabilityUnavailableError", capability: "jira" });
      expect(harness.comments).toEqual([]);
    }),
  );

  it.effect("lets a read-only client read tickets but not comment", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const scope = invocation({ capabilities: ["jira"], readOnlyClient: true });
      const listed = yield* harness.call("list_folder_jira_tickets", {}, scope);
      expect(listed).toEqual({ folder: null, tickets: [] });
      const error = yield* harness
        .call("comment_on_jira_ticket", { key: "DW-1", body: "Done" }, scope)
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "capability_denied" });
      expect(harness.comments).toEqual([]);
    }),
  );

  it.effect("lists the calling thread's folder tickets and comments as the thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const scope = invocation({ capabilities: ["jira"] });
      const listed = yield* harness.call("list_folder_jira_tickets", {}, scope);
      expect(listed).toEqual({ folder: "Checkout", tickets: [ticket("DW-1")] });
      yield* harness.call("comment_on_jira_ticket", { key: "DW-1", body: "Done" }, scope);
      expect(harness.comments).toEqual([{ key: "DW-1", body: "Done" }]);
    }),
  );
});

describe("findTransition", () => {
  const transitions = [
    { id: "21", name: "Start review", toStatus: "In Review" },
    { id: "31", name: "Done", toStatus: "Done" },
  ];

  it("matches the target status first, then the transition name, ignoring case", () => {
    expect(findTransition(transitions, "in review")?.id).toBe("21");
    expect(findTransition(transitions, "START REVIEW")?.id).toBe("21");
    expect(findTransition(transitions, " done ")?.id).toBe("31");
    expect(findTransition(transitions, "Blocked")).toBeNull();
  });
});
