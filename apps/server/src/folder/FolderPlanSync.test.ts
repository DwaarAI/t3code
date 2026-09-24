import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as FolderPlanSync from "./FolderPlanSync.ts";

type PlanEvent = Extract<OrchestrationEvent, { type: "thread.proposed-plan-upserted" }>;

const planEvent = (threadId: string, planId: string, implementedAt: string | null) =>
  ({
    type: "thread.proposed-plan-upserted",
    payload: {
      threadId: ThreadId.make(threadId),
      proposedPlan: {
        id: planId,
        turnId: null,
        planMarkdown: `# Plan ${planId}\n\n1. Build it\n`,
        implementedAt,
        implementationThreadId: null,
        createdAt: "2026-09-24T08:15:00.000Z",
        updatedAt: "2026-09-24T08:15:00.000Z",
      },
    },
  }) as unknown as PlanEvent;

/** Runs the mirror against a temp T3 home whose folders dir holds `checkout/`. */
const withMirror = <A, E>(
  body: (input: {
    readonly mirror: (event: PlanEvent) => Effect.Effect<void>;
    readonly contextDir: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const folderDir = path.join(path.resolve(config.foldersDir), "checkout");
    const threads: Record<string, Partial<OrchestrationThreadShell>> = {
      "t-repo": {
        title: "API work",
        projectId: ProjectId.make("p-api"),
        worktreePath: path.join(folderDir, "api"),
      },
      "t-folder": {
        title: "Checkout plan",
        projectId: ProjectId.make("p-folder"),
        worktreePath: null,
      },
      "t-plain": { title: "Elsewhere", projectId: ProjectId.make("p-api"), worktreePath: null },
    };
    const projects: Record<string, string> = { "p-api": "/repos/api", "p-folder": folderDir };
    const mirror = yield* FolderPlanSync.makePlanMirror.pipe(
      Effect.provide(
        Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
          getThreadShellById: (threadId) =>
            Effect.succeed(
              Option.fromNullishOr(threads[threadId] as OrchestrationThreadShell | undefined),
            ),
          getProjectShellById: (projectId) =>
            Effect.succeed(
              projects[projectId]
                ? Option.some({ workspaceRoot: projects[projectId] } as OrchestrationProjectShell)
                : Option.none(),
            ),
        }),
      ),
    );
    return yield* body({ mirror, contextDir: path.join(folderDir, ".context") });
  }).pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-folder-plans-" })),
    Effect.provide(NodeServices.layer),
  );

describe("FolderPlanSync", () => {
  it.effect("saves a repository thread's plan and makes it the current plan", () =>
    withMirror(({ mirror, contextDir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* mirror(planEvent("t-repo", "plan-aaaa1111", null));

        const saved = yield* fs.readDirectory(path.join(contextDir, "plans"));
        expect(saved).toEqual(["2026-09-24-0815-api-work-planaaaa.md"]);
        const current = yield* fs.readFileString(path.join(contextDir, "plan.md"));
        expect(current).toContain("# Plan plan-aaaa1111");
        expect(current).toContain("the api repository");
        expect(current).toContain(`plans/${saved[0]}`);
      }),
    ),
  );

  it.effect("keeps plan.md on the newest plan when an older one is marked implemented", () =>
    withMirror(({ mirror, contextDir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* mirror(planEvent("t-folder", "plan-old00000", null));
        yield* mirror(planEvent("t-folder", "plan-new00000", null));
        yield* mirror(planEvent("t-folder", "plan-old00000", "2026-09-24T09:00:00.000Z"));

        const current = yield* fs.readFileString(path.join(contextDir, "plan.md"));
        expect(current).toContain("# Plan plan-new00000");
        expect(current).toContain("the folder session");
        expect(yield* fs.readDirectory(path.join(contextDir, "plans"))).toHaveLength(2);
      }),
    ),
  );

  it.effect("ignores threads outside folders", () =>
    withMirror(({ mirror, contextDir }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* mirror(planEvent("t-plain", "plan-bbbb2222", null));
        yield* mirror(planEvent("t-missing", "plan-cccc3333", null));
        expect(yield* fs.exists(contextDir)).toBe(false);
      }),
    ),
  );
});
