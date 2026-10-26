/**
 * FolderPlanSync - Saves plans proposed in folder threads to the folder's
 * `.context`, so every session in the folder works from the same plan.
 *
 * Each proposed plan gets its own file in `plans/`, and a newly finalized plan
 * becomes `plan.md`. A plan that is updated again rewrites its own file but
 * leaves `plan.md` alone, since a newer plan may have replaced it by then.
 */
import type { OrchestrationV2DomainEvent, OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { planFileName, renderPlanFile, resolveFolderScope } from "./folderLayout.ts";

type TurnItemEvent = Extract<OrchestrationV2DomainEvent, { type: "turn-item.updated" }>;
type ProposedPlanItem = Extract<OrchestrationV2TurnItem, { type: "proposed_plan" }>;

/** A proposed plan the provider finished writing. */
const finishedPlan = (event: OrchestrationV2DomainEvent): ProposedPlanItem | null =>
  event.type === "turn-item.updated" &&
  event.payload.type === "proposed_plan" &&
  !event.payload.streaming &&
  event.payload.markdown.trim().length > 0
    ? event.payload
    : null;

/** @public The handler, exported so tests can feed it events without the orchestrator. */
export const makePlanMirror = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const foldersDir = path.resolve(serverConfig.foldersDir);

  return (event: TurnItemEvent) =>
    Effect.gen(function* () {
      const plan = finishedPlan(event);
      if (plan === null) return;
      const thread = yield* threads.getThreadShell(plan.threadId);
      if (thread === null) return;
      // Folder sessions run in the folder's own project, not in a worktree.
      const cwd =
        thread.worktreePath ??
        Option.getOrUndefined(yield* projects.getById(thread.projectId))?.workspaceRoot;
      const scope = resolveFolderScope(cwd, foldersDir);
      if (scope === null) return;

      const fileName = planFileName({
        planId: plan.planId,
        createdAt: DateTime.formatIso(plan.startedAt ?? event.occurredAt),
        threadTitle: thread.title,
      });
      const plansDir = path.join(scope.contextDir, "plans");
      const planPath = path.join(plansDir, fileName);
      const isNew = !(yield* fs.exists(planPath));
      yield* fs.makeDirectory(plansDir, { recursive: true });
      yield* fs.writeFileString(
        planPath,
        renderPlanFile({
          planMarkdown: plan.markdown,
          threadTitle: thread.title,
          repoName: scope.repoName,
          fileName: null,
        }),
      );
      if (isNew) {
        yield* fs.writeFileString(
          path.join(scope.contextDir, "plan.md"),
          renderPlanFile({
            planMarkdown: plan.markdown,
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
    const threads = yield* ThreadManagementService.ThreadManagementService;
    const mirror = yield* makePlanMirror;
    yield* Stream.runForEach(threads.streamDomainEvents, (event) =>
      event.type === "turn-item.updated" ? mirror(event) : Effect.void,
    ).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Folder plan sync stopped", cause)),
      Effect.forkScoped,
    );
  }),
);
