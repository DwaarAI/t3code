import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  GitCommandError,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as FolderGitHub from "./FolderGitHub.ts";
import * as FolderService from "./FolderService.ts";

const API = ProjectId.make("project-api");
const WEB = ProjectId.make("project-web");
const BROKEN = ProjectId.make("project-broken");

interface Harness {
  readonly worktreeCalls: Array<{
    cwd: string;
    refName: string;
    newRefName?: string;
    path: string;
  }>;
  readonly removedWorktrees: string[];
  readonly dispatched: OrchestrationCommand[];
  readonly dirtyWorktrees: Set<string>;
  readonly existingBranches: Set<string>;
  readonly github: string[];
  threads: ReadonlyArray<Partial<OrchestrationThread>>;
}

const makeHarness = (): Harness => ({
  worktreeCalls: [],
  removedWorktrees: [],
  dispatched: [],
  dirtyWorktrees: new Set(),
  existingBranches: new Set(),
  github: [],
  threads: [],
});

const projectRoots: Record<string, string> = {
  [API]: "/repos/api",
  [WEB]: "/repos/web",
  [BROKEN]: "/repos/broken",
};

const gitError = (detail: string) =>
  new GitCommandError({ operation: "test", command: "git", cwd: "/repos", detail });

const makeLayer = (harness: Harness) =>
  FolderService.layer.pipe(
    Layer.provide(
      Layer.effect(
        GitWorkflowService.GitWorkflowService,
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const git: Partial<GitWorkflowService.GitWorkflowService["Service"]> = {
            hasCommit: ({ refName }) =>
              Effect.succeed(harness.existingBranches.has(refName.replace("refs/heads/", ""))),
            createWorktree: (input) =>
              Effect.gen(function* () {
                if (input.cwd === projectRoots[BROKEN]) {
                  return yield* gitError("fatal: invalid reference: main");
                }
                const path = input.path!;
                harness.worktreeCalls.push({
                  cwd: input.cwd,
                  refName: input.refName,
                  ...(input.newRefName ? { newRefName: input.newRefName } : {}),
                  path,
                });
                yield* fs.makeDirectory(path, { recursive: true }).pipe(Effect.orDie);
                return {
                  worktree: { path, refName: input.newRefName ?? input.refName },
                } as never;
              }),
            removeWorktree: (input) =>
              Effect.gen(function* () {
                harness.removedWorktrees.push(input.path);
                yield* fs.remove(input.path, { recursive: true }).pipe(Effect.orDie);
              }),
          };
          return git as GitWorkflowService.GitWorkflowService["Service"];
        }),
      ),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver.GitVcsDriver)({
        statusDetailsLocal: (cwd) =>
          Effect.succeed({
            hasWorkingTreeChanges: harness.dirtyWorktrees.has(cwd),
          } as GitVcsDriver.GitStatusDetails),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
        getProjectShellById: (projectId) =>
          Effect.succeed(
            projectRoots[projectId]
              ? Option.some({
                  id: projectId,
                  workspaceRoot: projectRoots[projectId],
                } as OrchestrationProjectShell)
              : Option.none(),
          ),
        getShellSnapshot: () =>
          Effect.succeed({ threads: harness.threads } as unknown as OrchestrationShellSnapshot),
        getThreadDetailById: (threadId) =>
          Effect.succeed(
            Option.fromNullishOr(
              harness.threads.find((thread) => thread.id === threadId) as
                | OrchestrationThread
                | undefined,
            ),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(FolderGitHub.FolderGitHub)({
        fetchIssue: (issue) =>
          Effect.succeed({
            ref: {
              repository: issue.repository,
              number: issue.number,
              url: `https://github.com/${issue.repository}/issues/${issue.number}`,
              title: "Checkout flow",
            },
            body: "Build checkout.",
            author: "octocat",
            parent: {
              repository: issue.repository,
              number: 1,
              url: `https://github.com/${issue.repository}/issues/1`,
              title: "Payments",
            },
          }),
        comment: (issue, body) =>
          Effect.sync(() => {
            harness.github.push(`comment ${issue.repository}#${issue.number}: ${body}`);
          }),
        setStatus: (issue, status) =>
          Effect.sync(() => {
            harness.github.push(`status ${issue.repository}#${issue.number}: ${status}`);
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
        dispatch: (command) =>
          Effect.sync(() => {
            harness.dispatched.push(command);
            return { sequence: harness.dispatched.length };
          }),
      }),
    ),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-folder-service-" })),
    Layer.provideMerge(NodeServices.layer),
  );

/** Runs a test body against one service instance and one temporary T3 home. */
const scenario = <A, E>(
  body: (
    service: FolderService.FolderService["Service"],
    harness: Harness,
  ) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* FolderService.FolderService;
    return yield* body(service, harness);
  }).pipe(Effect.provide(makeLayer(harness)));
};

describe("FolderService", () => {
  it.effect("creates one worktree per repository plus a shared .context", () =>
    scenario((service, harness) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = yield* service.create({
          name: "Auth Revamp",
          members: [
            { projectId: API, baseBranch: "main" },
            { projectId: WEB, baseBranch: "develop" },
          ],
        });

        expect(folder.slug).toBe("auth-revamp");
        expect(folder.members.map((member) => [member.repoName, member.branch])).toEqual([
          ["api", "feat/auth-revamp"],
          ["web", "feat/auth-revamp"],
        ]);
        expect(harness.worktreeCalls).toEqual([
          {
            cwd: "/repos/api",
            refName: "main",
            newRefName: "feat/auth-revamp",
            path: path.join(folder.path, "api"),
          },
          {
            cwd: "/repos/web",
            refName: "develop",
            newRefName: "feat/auth-revamp",
            path: path.join(folder.path, "web"),
          },
        ]);
        for (const file of ["README.md", "plan.md", "todos.md", "handoffs", "reviews"]) {
          expect(yield* fs.exists(path.join(folder.contextDir, file))).toBe(true);
        }

        const listed = yield* service.list();
        expect(listed.folders.map((entry) => entry.slug)).toEqual(["auth-revamp"]);
        expect(yield* fs.exists(path.join(listed.guidesDir, "code-review.md"))).toBe(true);

        const duplicate = yield* service
          .create({ name: "auth revamp", members: [{ projectId: API, baseBranch: "main" }] })
          .pipe(Effect.flip);
        expect(duplicate.reason).toBe("already_exists");
      }),
    ),
  );

  it.effect("checks out an existing branch instead of creating it", () =>
    scenario((service, harness) =>
      Effect.gen(function* () {
        harness.existingBranches.add("feat/shared");
        yield* service.create({
          name: "Shared",
          branch: "feat/shared",
          members: [{ projectId: API, baseBranch: "main" }],
        });
        expect(harness.worktreeCalls[0]).toMatchObject({ refName: "feat/shared" });
        expect(harness.worktreeCalls[0]?.newRefName).toBeUndefined();
      }),
    ),
  );

  it.effect("rolls back created worktrees when a later repository fails", () =>
    scenario((service, harness) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const error = yield* service
          .create({
            name: "Half Built",
            members: [
              { projectId: API, baseBranch: "main" },
              { projectId: BROKEN, baseBranch: "main" },
            ],
          })
          .pipe(Effect.flip);

        expect(error.reason).toBe("git_failed");
        expect(harness.removedWorktrees).toHaveLength(1);
        const listed = yield* service.list();
        expect(listed.folders).toEqual([]);
        expect(yield* fs.exists(path.join(listed.foldersDir, "half-built"))).toBe(false);
      }),
    ),
  );

  it.effect("archives a worktree, settles its threads, and restores it", () =>
    scenario((service, harness) =>
      Effect.gen(function* () {
        const folder = yield* service.create({
          name: "Billing",
          members: [{ projectId: API, baseBranch: "main" }],
        });
        const member = folder.members[0]!;
        harness.threads = [
          { id: ThreadId.make("t-live"), worktreePath: member.worktreePath, archivedAt: null },
          {
            id: ThreadId.make("t-settled"),
            worktreePath: member.worktreePath,
            archivedAt: null,
            settledAt: "2026-01-01T00:00:00.000Z",
          },
          { id: ThreadId.make("t-other"), worktreePath: "/elsewhere", archivedAt: null },
        ];
        harness.dirtyWorktrees.add(member.worktreePath);

        const dirty = yield* service
          .archiveMember({ slug: folder.slug, projectId: API })
          .pipe(Effect.flip);
        expect(dirty.reason).toBe("dirty_worktree");

        const archived = yield* service.archiveMember({
          slug: folder.slug,
          projectId: API,
          force: true,
        });
        expect(archived.members[0]?.archivedAt).not.toBeNull();
        expect(harness.dispatched).toEqual([
          expect.objectContaining({ type: "thread.settle", threadId: "t-live" }),
        ]);

        harness.existingBranches.add(member.branch);
        const restored = yield* service.restoreMember({ slug: folder.slug, projectId: API });
        expect(restored.members[0]?.archivedAt).toBeNull();
        expect(harness.worktreeCalls.at(-1)).toMatchObject({
          refName: member.branch,
          path: member.worktreePath,
        });
      }),
    ),
  );

  it.effect("writes a handoff note into the folder's .context", () =>
    scenario((service, harness) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = yield* service.create({
          name: "Search",
          members: [{ projectId: API, baseBranch: "main" }],
        });
        const member = folder.members[0]!;
        harness.threads = [
          {
            id: ThreadId.make("t-impl"),
            title: "Implement search",
            worktreePath: member.worktreePath,
            branch: member.branch,
            modelSelection: { instanceId: "claude", model: "opus" } as never,
            proposedPlans: [],
            messages: [
              { role: "user", text: "Add search", streaming: false } as never,
              { role: "assistant", text: "Added a search index.", streaming: false } as never,
            ],
          },
          { id: ThreadId.make("t-outside"), title: "Outside", worktreePath: "/repos/api" },
        ];

        const { path: notePath } = yield* service.writeHandoff({
          threadId: ThreadId.make("t-impl"),
        });
        expect(path.dirname(notePath)).toBe(path.join(folder.contextDir, "handoffs"));
        const note = yield* fs.readFileString(notePath);
        expect(note).toContain("Added a search index.");
        expect(note).toContain("git diff main...HEAD");

        const outside = yield* service
          .writeHandoff({ threadId: ThreadId.make("t-outside") })
          .pipe(Effect.flip);
        expect(outside.reason).toBe("not_in_folder");
      }),
    ),
  );
  it.effect("links a GitHub issue, snapshots it, and reports the folder on it", () =>
    scenario((service, harness) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const invalid = yield* service
          .create({
            name: "Bad",
            members: [{ projectId: API, baseBranch: "main" }],
            issue: "not-an-issue",
          })
          .pipe(Effect.flip);
        expect(invalid.reason).toBe("invalid_input");

        const folder = yield* service.create({
          name: "Checkout",
          members: [{ projectId: API, baseBranch: "main" }],
          issue: "https://github.com/acme/api/issues/42",
          initialPrompt: "  Plan first.  ",
        });
        expect(folder.issue).toMatchObject({
          repository: "acme/api",
          number: 42,
          status: "in-progress",
          parent: { number: 1, title: "Payments" },
        });
        expect(folder.initialPrompt).toBe("Plan first.");
        const snapshot = yield* fs.readFileString(path.join(folder.contextDir, "issue.md"));
        expect(snapshot).toContain("Build checkout.");
        expect(snapshot).toContain("gh issue view 1 --repo acme/api");
        expect(harness.github[0]).toContain("comment acme/api#42: T3 Code folder **Checkout**");
        expect(harness.github[1]).toBe("status acme/api#42: in-progress");

        const reviewed = yield* service.setIssueStatus({ slug: folder.slug, status: "in-review" });
        expect(reviewed.issue?.status).toBe("in-review");
        const listed = yield* service.list();
        expect(listed.folders[0]?.issue?.status).toBe("in-review");
      }),
    ),
  );
});
