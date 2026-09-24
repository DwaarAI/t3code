/**
 * FolderPlanSync - Saves plans proposed in folder threads to the folder's
 * `.context`, so every session in the folder works from the same plan.
 *
 * Each proposed plan gets its own file in `plans/`, and a newly finalized plan
 * becomes `plan.md`. Marking a plan implemented upserts it again; that rewrites
 * its own file but leaves `plan.md` alone, since a newer plan may have replaced
 * it by then.
 */
import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { planFileName, renderPlanFile, resolveFolderScope } from "./folderLayout.ts";

type ProposedPlanEvent = Extract<OrchestrationEvent, { type: "thread.proposed-plan-upserted" }>;

/** @public The handler, exported so tests can feed it events without the engine. */
export const makePlanMirror = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const foldersDir = path.resolve(serverConfig.foldersDir);

  return (event: ProposedPlanEvent) =>
    Effect.gen(function* () {
      const thread = Option.getOrUndefined(
        yield* snapshotQuery.getThreadShellById(event.payload.threadId),
      );
      if (!thread) return;
      // Folder sessions run in the folder's own project, not in a worktree.
      const cwd =
        thread.worktreePath ??
        Option.getOrUndefined(yield* snapshotQuery.getProjectShellById(thread.projectId))
          ?.workspaceRoot;
      const scope = resolveFolderScope(cwd, foldersDir);
      if (scope === null) return;

      const plan = event.payload.proposedPlan;
      const fileName = planFileName({
        planId: plan.id,
        createdAt: plan.createdAt,
        threadTitle: thread.title,
      });
      const plansDir = path.join(scope.contextDir, "plans");
      yield* fs.makeDirectory(plansDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(plansDir, fileName),
        renderPlanFile({
          planMarkdown: plan.planMarkdown,
          threadTitle: thread.title,
          repoName: scope.repoName,
          fileName: null,
        }),
      );
      if (plan.implementedAt === null) {
        yield* fs.writeFileString(
          path.join(scope.contextDir, "plan.md"),
          renderPlanFile({
            planMarkdown: plan.planMarkdown,
            threadTitle: thread.title,
            repoName: scope.repoName,
            fileName,
          }),
        );
      }
    }).pipe(
      // A plan that cannot be mirrored stays in its thread; never stop the stream.
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not save a proposed plan to the folder's .context", cause),
      ),
    );
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngine.OrchestrationEngineService;
    const mirror = yield* makePlanMirror;
    yield* Stream.runForEach(engine.streamDomainEvents, (event) =>
      event.type === "thread.proposed-plan-upserted" ? mirror(event) : Effect.void,
    ).pipe(Effect.forkScoped);
  }),
);
