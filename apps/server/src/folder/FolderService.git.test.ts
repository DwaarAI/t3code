import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as FolderGitHub from "./FolderGitHub.ts";
import * as FolderService from "./FolderService.ts";

const API = ProjectId.make("project-api");
const WEB = ProjectId.make("project-web");

const git = (cwd: string, ...args: string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const exitCode = yield* spawner.exitCode(
      ChildProcess.make("git", ["-c", "user.name=t3", "-c", "user.email=t3@test", ...args], {
        cwd,
      }),
    );
    expect(exitCode).toBe(0);
  }).pipe(Effect.scoped);

const gitOutput = (cwd: string, ...args: string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return (yield* spawner.string(ChildProcess.make("git", args, { cwd }))).trim();
  }).pipe(Effect.scoped);

/** Real git underneath; only project lookup and orchestration are stubbed. */
const makeLayer = (roots: Record<string, string>) => {
  const config = ServerConfig.layerTest(process.cwd(), { prefix: "t3-folder-git-" });
  const gitWorkflow = GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        resolve: () => Effect.succeed({ kind: "git" } as VcsDriverRegistry.VcsDriverHandle),
      }),
    ),
    Layer.provide(GitVcsDriver.layer),
    Layer.provide(Layer.mock(GitManager.GitManager)({})),
  );
  return FolderService.layer.pipe(
    Layer.provide(gitWorkflow),
    Layer.provide(GitVcsDriver.layer),
    Layer.provide(Layer.mock(FolderGitHub.FolderGitHub)({})),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
        getProjectShellById: (projectId) =>
          Effect.succeed(
            roots[projectId]
              ? Option.some({
                  id: projectId,
                  workspaceRoot: roots[projectId],
                } as OrchestrationProjectShell)
              : Option.none(),
          ),
        getShellSnapshot: () =>
          Effect.succeed({ threads: [] } as unknown as OrchestrationShellSnapshot),
      }),
    ),
    Layer.provide(
      Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
        dispatch: () => Effect.succeed({ sequence: 0 }),
      }),
    ),
    Layer.provide(config),
    Layer.provideMerge(NodeServices.layer),
  );
};

const makeRepo = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const parent = yield* fs.makeTempDirectoryScoped({ prefix: "t3-folder-repo-" });
    const root = path.join(parent, name);
    yield* fs.makeDirectory(root);
    yield* git(root, "init", "--initial-branch=main");
    yield* fs.writeFileString(path.join(root, "README.md"), `# ${name}\n`);
    yield* git(root, "add", ".");
    yield* git(root, "commit", "-m", "init");
    return root;
  });

describe("FolderService with git", () => {
  it.effect("creates, archives, and restores real worktrees", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const api = yield* makeRepo("api");
      const web = yield* makeRepo("web");

      yield* Effect.gen(function* () {
        const service = yield* FolderService.FolderService;
        const folder = yield* service.create({
          name: "Checkout flow",
          members: [
            { projectId: API, baseBranch: "main" },
            { projectId: WEB, baseBranch: "main" },
          ],
        });
        const apiMember = folder.members[0]!;
        expect(yield* gitOutput(apiMember.worktreePath, "branch", "--show-current")).toBe(
          "feat/checkout-flow",
        );
        expect(yield* fs.exists(path.join(folder.path, "web", "README.md"))).toBe(true);

        yield* fs.writeFileString(path.join(apiMember.worktreePath, "wip.txt"), "unsaved");
        const dirty = yield* service
          .archiveMember({ slug: folder.slug, projectId: API })
          .pipe(Effect.flip);
        expect(dirty.reason, dirty.detail).toBe("dirty_worktree");
        expect(yield* fs.exists(apiMember.worktreePath)).toBe(true);

        yield* service.archiveMember({ slug: folder.slug, projectId: API, force: true });
        expect(yield* fs.exists(apiMember.worktreePath)).toBe(false);

        const restored = yield* service.restoreMember({ slug: folder.slug, projectId: API });
        expect(restored.members[0]?.archivedAt).toBeNull();
        expect(yield* gitOutput(apiMember.worktreePath, "branch", "--show-current")).toBe(
          "feat/checkout-flow",
        );
      }).pipe(Effect.provide(makeLayer({ [API]: api, [WEB]: web })));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("branches new worktrees from the latest origin and copies ignored .env files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const api = yield* makeRepo("api");
      // Only the root .env and apps/web/.env.local are ignored; packages/new is not.
      yield* fs.writeFileString(
        path.join(api, ".gitignore"),
        "/.env\napps/web/.env.local\nnode_modules/\n",
      );
      yield* git(api, "add", ".gitignore");
      yield* git(api, "commit", "-m", "ignore env");

      // origin/main moves ahead of the local main the project is checked out on.
      const remote = `${api}-origin.git`;
      yield* git(api, "clone", "--bare", api, remote);
      yield* git(api, "remote", "add", "origin", remote);
      const other = `${api}-other`;
      yield* git(api, "clone", remote, other);
      yield* fs.writeFileString(path.join(other, "NEW.md"), "from origin\n");
      yield* git(other, "add", "NEW.md");
      yield* git(other, "commit", "-m", "remote only");
      yield* git(other, "push", "origin", "HEAD:main");
      const originHead = yield* gitOutput(other, "rev-parse", "HEAD");

      yield* fs.writeFileString(path.join(api, ".env"), "SECRET=1\n");
      yield* fs.makeDirectory(path.join(api, "apps", "web"), { recursive: true });
      yield* fs.writeFileString(path.join(api, "apps", "web", ".env.local"), "LOCAL=1\n");
      // Not ignored and in a directory git has never seen, like a new package.
      yield* fs.makeDirectory(path.join(api, "packages", "new"), { recursive: true });
      yield* fs.writeFileString(path.join(api, "packages", "new", ".env"), "NEW=1\n");
      yield* fs.makeDirectory(path.join(api, "node_modules", "pkg"), { recursive: true });
      yield* fs.writeFileString(path.join(api, "node_modules", "pkg", ".env"), "NOPE=1\n");

      yield* Effect.gen(function* () {
        const service = yield* FolderService.FolderService;
        const folder = yield* service.create({
          name: "Fresh",
          members: [{ projectId: API, baseBranch: "main" }],
        });
        const member = folder.members[0]!;

        expect(yield* gitOutput(member.worktreePath, "rev-parse", "HEAD")).toBe(originHead);
        expect(member.setup?.baseRef).toBe(`origin/main@${originHead.slice(0, 7)}`);
        expect([...(member.setup?.envFiles ?? [])].sort()).toEqual([
          ".env",
          "apps/web/.env.local",
          "packages/new/.env",
        ]);
        expect(yield* fs.readFileString(path.join(member.worktreePath, ".env"))).toBe("SECRET=1\n");
        expect(yield* fs.exists(path.join(member.worktreePath, "node_modules"))).toBe(false);

        // Re-copying replaces a stale worktree copy with the checkout's current file.
        yield* fs.writeFileString(path.join(api, ".env"), "SECRET=2\n");
        yield* service.copyEnvFiles({ slug: folder.slug, projectId: API });
        expect(yield* fs.readFileString(path.join(member.worktreePath, ".env"))).toBe("SECRET=2\n");
      }).pipe(Effect.provide(makeLayer({ [API]: api })));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
