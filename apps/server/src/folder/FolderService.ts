/**
 * FolderService - Creates and maintains feature folders on disk.
 *
 * A folder is `<foldersDir>/<slug>/` with a `folder.json` manifest, a shared
 * `.context/` directory, and one git worktree per member repository. The
 * manifest is the source of truth; threads join a folder by running in one of
 * its worktrees, so the orchestration model needs no folder aggregate.
 */
import {
  CommandId,
  FolderError,
  FolderManifest,
  type Folder,
  type FolderAddMemberInput,
  type FolderCreateInput,
  type FolderHandoffInput,
  type FolderHandoffResult,
  type FolderMember,
  type FolderMemberInput,
  type FolderMemberRefInput,
  type FolderMemberSetup,
  type FolderDeleteResult,
  type FolderRefInput,
  type FolderSetIssueStatusInput,
  type FoldersListResult,
  ProjectId,
} from "@t3tools/contracts";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  FOLDER_CONTEXT_DIR,
  FOLDER_CONTEXT_SUBDIRS,
  FOLDER_MANIFEST_FILE,
  SEED_GUIDES,
  buildHandoffMarkdown,
  envFilesToCopy,
  folderContextScaffold,
  handoffFileName,
  resolveFolderScope,
  slugifyFolderName,
  uniqueRepoName,
} from "./folderLayout.ts";
import * as FolderGitHub from "./FolderGitHub.ts";
import { parseIssueReference, renderIssueContext } from "./githubIssues.ts";

const decodeManifest = Schema.decodeEffect(fromLenientJson(FolderManifest));
const encodeManifest = Schema.encodeEffect(fromJsonStringPretty(FolderManifest));

export class FolderService extends Context.Service<
  FolderService,
  {
    readonly list: () => Effect.Effect<FoldersListResult, FolderError>;
    readonly create: (input: FolderCreateInput) => Effect.Effect<Folder, FolderError>;
    readonly addMember: (input: FolderAddMemberInput) => Effect.Effect<Folder, FolderError>;
    readonly archiveMember: (input: FolderMemberRefInput) => Effect.Effect<Folder, FolderError>;
    readonly restoreMember: (input: FolderMemberRefInput) => Effect.Effect<Folder, FolderError>;
    readonly archive: (input: FolderRefInput) => Effect.Effect<Folder, FolderError>;
    readonly restore: (input: FolderRefInput) => Effect.Effect<Folder, FolderError>;
    readonly setIssueStatus: (
      input: FolderSetIssueStatusInput,
    ) => Effect.Effect<Folder, FolderError>;
    /** Removes the worktrees and the folder directory, including `.context`. */
    readonly delete: (input: FolderRefInput) => Effect.Effect<FolderDeleteResult, FolderError>;
    /** Copies the project's `.env*` files into a member worktree again, replacing older copies. */
    readonly copyEnvFiles: (input: FolderMemberRefInput) => Effect.Effect<Folder, FolderError>;
    readonly writeHandoff: (
      input: FolderHandoffInput,
    ) => Effect.Effect<FolderHandoffResult, FolderError>;
  }
>()("t3/folder/FolderService") {}

const fail = (reason: FolderError["reason"], detail: string, cause?: unknown) =>
  Effect.fail(new FolderError({ reason, detail, ...(cause === undefined ? {} : { cause }) }));

const ioFailed = (detail: string) => (cause: unknown) =>
  new FolderError({ reason: "io_failed", detail, cause });

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const gitDriver = yield* GitVcsDriver.GitVcsDriver;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const github = yield* FolderGitHub.FolderGitHub;
  const foldersDir = path.resolve(serverConfig.foldersDir);
  const guidesDir = path.resolve(serverConfig.guidesDir);
  // Manifest writes read-modify-write the file, so mutations run one at a time.
  const mutation = yield* Semaphore.make(1);

  const folderDirFor = (slug: string) => path.join(foldersDir, slug);
  const manifestPathFor = (slug: string) => path.join(folderDirFor(slug), FOLDER_MANIFEST_FILE);
  const toFolder = (manifest: FolderManifest): Folder => ({
    ...manifest,
    path: folderDirFor(manifest.slug),
    contextDir: path.join(folderDirFor(manifest.slug), FOLDER_CONTEXT_DIR),
  });

  const ensureGuidesDir = Effect.gen(function* () {
    if (yield* fs.exists(guidesDir)) return;
    yield* fs.makeDirectory(guidesDir, { recursive: true });
    for (const [name, contents] of Object.entries(SEED_GUIDES)) {
      yield* fs.writeFileString(path.join(guidesDir, name), contents);
    }
  }).pipe(Effect.mapError(ioFailed(`Could not create the guides directory at ${guidesDir}.`)));

  const readManifest = (slug: string) =>
    Effect.gen(function* () {
      const manifestPath = manifestPathFor(slug);
      if (!(yield* fs.exists(manifestPath).pipe(Effect.orElseSucceed(() => false)))) {
        return yield* fail("not_found", `Folder '${slug}' does not exist.`);
      }
      const raw = yield* fs
        .readFileString(manifestPath)
        .pipe(Effect.mapError(ioFailed(`Could not read ${manifestPath}.`)));
      return yield* decodeManifest(raw).pipe(
        Effect.mapError(ioFailed(`${manifestPath} is not a valid folder manifest.`)),
      );
    });

  const writeManifest = (manifest: FolderManifest) =>
    encodeManifest(manifest).pipe(
      Effect.flatMap((contents) =>
        writeFileStringAtomically({
          filePath: manifestPathFor(manifest.slug),
          contents: `${contents}\n`,
        }),
      ),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(ioFailed(`Could not write the manifest for folder '${manifest.slug}'.`)),
      Effect.as(toFolder(manifest)),
    );

  const resolveProjectRoot = (projectId: ProjectId) =>
    snapshotQuery.getProjectShellById(projectId).pipe(
      Effect.mapError(ioFailed("Could not read projects.")),
      Effect.flatMap(
        Option.match({
          onNone: () => fail("project_not_found", `Project '${projectId}' was not found.`),
          onSome: (project) => Effect.succeed(project.workspaceRoot),
        }),
      ),
    );

  const gitFailed = (error: { readonly message: string }) =>
    new FolderError({ reason: "git_failed", detail: error.message, cause: error });

  /**
   * The freshest commit to branch from: `origin/<base>` after a fetch, so a
   * new worktree starts from what is on the remote even when the project's
   * checkout is behind. The checkout itself is left alone. Falls back to the
   * local branch when there is no origin, the fetch fails, or origin lacks it.
   */
  const resolveBaseRef = (projectRoot: string, baseBranch: string) =>
    Effect.gen(function* () {
      const local = { ref: baseBranch, label: baseBranch };
      const hasOrigin = yield* gitWorkflow.remoteExists({ cwd: projectRoot, remoteName: "origin" });
      if (!hasOrigin) return local;
      yield* gitWorkflow.fetchRemote({
        cwd: projectRoot,
        remoteName: "origin",
        refName: baseBranch,
      });
      const onOrigin = yield* gitWorkflow.remoteBranchExists({
        cwd: projectRoot,
        remoteName: "origin",
        refName: baseBranch,
      });
      if (!onOrigin) return local;
      const remote = yield* gitWorkflow.resolveRemoteTrackingCommit({
        cwd: projectRoot,
        refName: baseBranch,
        fallbackRemoteName: "origin",
      });
      return {
        ref: remote.commitSha,
        label: `${remote.remoteRefName}@${remote.commitSha.slice(0, 7)}`,
      };
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `Could not fetch ${baseBranch} for ${projectRoot}; branching from the local branch.`,
          error,
        ).pipe(Effect.as({ ref: baseBranch, label: baseBranch })),
      ),
    );

  /**
   * Check out `branch` at `worktreePath`, creating the branch from the latest
   * base when missing. Returns what a new branch started from, or null.
   */
  const checkOutWorktree = (input: {
    readonly projectRoot: string;
    readonly branch: string;
    readonly baseBranch: string;
    readonly worktreePath: string;
  }) =>
    Effect.gen(function* () {
      const branchExists = yield* gitWorkflow.hasCommit({
        cwd: input.projectRoot,
        refName: `refs/heads/${input.branch}`,
      });
      if (branchExists) {
        yield* gitWorkflow.createWorktree({
          cwd: input.projectRoot,
          refName: input.branch,
          path: input.worktreePath,
        });
        return null;
      }
      const base = yield* resolveBaseRef(input.projectRoot, input.baseBranch);
      yield* gitWorkflow.createWorktree({
        cwd: input.projectRoot,
        refName: base.ref,
        newRefName: input.branch,
        baseRefName: input.baseBranch,
        path: input.worktreePath,
      });
      return base.label;
    }).pipe(Effect.mapError(gitFailed));

  /**
   * Gitignored `.env*` files never reach a new worktree, so copy them from the
   * project's checkout. Best effort: a missing env file must not block the
   * worktree the user asked for.
   */
  const copyProjectEnvFiles = (input: {
    readonly projectRoot: string;
    readonly worktreePath: string;
    readonly overwrite: boolean;
  }) =>
    Effect.gen(function* () {
      const list = (operation: string, args: ReadonlyArray<string>) =>
        gitDriver
          .execute({ operation, cwd: input.projectRoot, args, maxOutputBytes: 8_000_000 })
          .pipe(Effect.map((result) => result.stdout.split("\0")));
      // Ignored files, with wholly ignored directories such as node_modules
      // collapsed so git never walks them; then untracked files git does not
      // ignore, which the collapsed listing can hide inside a new directory.
      const ignored = yield* list("FolderService.listIgnoredEnvFiles", [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
      ]);
      const untracked = yield* list("FolderService.listUntrackedEnvFiles", [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ":(glob)**/.env*",
      ]);
      const copied: string[] = [];
      for (const relative of new Set(envFilesToCopy([...ignored, ...untracked]))) {
        const target = path.join(input.worktreePath, relative);
        if (!input.overwrite && (yield* fs.exists(target))) continue;
        yield* fs.makeDirectory(path.dirname(target), { recursive: true });
        yield* fs.copyFile(path.join(input.projectRoot, relative), target);
        copied.push(relative);
      }
      return copied;
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(`Could not copy .env files into ${input.worktreePath}`, error).pipe(
          Effect.as([] as string[]),
        ),
      ),
    );

  /** Worktree plus the default setup every new worktree gets. */
  const prepareWorktree = (input: {
    readonly projectRoot: string;
    readonly branch: string;
    readonly baseBranch: string;
    readonly worktreePath: string;
  }) =>
    Effect.gen(function* () {
      const baseRef = yield* checkOutWorktree(input);
      const envFiles = yield* copyProjectEnvFiles({
        projectRoot: input.projectRoot,
        worktreePath: input.worktreePath,
        overwrite: false,
      });
      return { baseRef, envFiles, at: yield* nowIso } satisfies FolderMemberSetup;
    });

  const createMember = (input: {
    readonly slug: string;
    readonly branch: string;
    readonly member: FolderMemberInput;
    readonly takenRepoNames: ReadonlyArray<string>;
  }) =>
    Effect.gen(function* () {
      const projectRoot = yield* resolveProjectRoot(input.member.projectId);
      const repoName = uniqueRepoName(path, projectRoot, input.takenRepoNames);
      const worktreePath = path.join(folderDirFor(input.slug), repoName);
      const setup = yield* prepareWorktree({
        projectRoot,
        branch: input.branch,
        baseBranch: input.member.baseBranch,
        worktreePath,
      });
      return {
        projectId: input.member.projectId,
        repoName,
        branch: input.branch,
        baseBranch: input.member.baseBranch,
        worktreePath,
        archivedAt: null,
        setup,
      } satisfies FolderMember;
    });

  const removeMemberWorktree = (member: FolderMember, force: boolean) =>
    Effect.gen(function* () {
      if (!force) {
        // Asked explicitly: git's own refusal reaches us without its reason.
        // A worktree that is already gone has nothing to lose.
        const dirty = yield* gitDriver.statusDetailsLocal(member.worktreePath).pipe(
          Effect.map((status) => status.hasWorkingTreeChanges),
          Effect.orElseSucceed(() => false),
        );
        if (dirty) {
          return yield* fail(
            "dirty_worktree",
            `${member.repoName} has uncommitted changes. Commit them, or archive with force to discard them.`,
          );
        }
      }
      // A project removed from T3 Code leaves its folders behind. Without the
      // repository git cannot retire the worktree, so drop the directory and
      // leave the stale record for `git worktree prune`; otherwise the folder
      // could never be archived or deleted.
      const projectRoot = yield* resolveProjectRoot(member.projectId).pipe(
        Effect.map((root): string | null => root),
        Effect.catchIf(
          (error) => error.reason === "project_not_found",
          () => Effect.succeed(null),
        ),
      );
      if (projectRoot === null) {
        yield* Effect.logInfo(
          `Project ${member.projectId} is gone; removing ${member.worktreePath} directly.`,
        );
        yield* fs.remove(member.worktreePath, { recursive: true }).pipe(Effect.ignore);
        return;
      }
      yield* gitWorkflow
        .removeWorktree({ cwd: projectRoot, path: member.worktreePath, force })
        .pipe(Effect.mapError(gitFailed));
    });

  /** Settle the worktree's live threads so they leave active lists everywhere. */
  const settleMemberThreads = (member: FolderMember) =>
    Effect.gen(function* () {
      const snapshot = yield* snapshotQuery.getShellSnapshot();
      const threads = snapshot.threads.filter(
        (thread) =>
          thread.worktreePath === member.worktreePath &&
          thread.archivedAt === null &&
          thread.settledAt == null,
      );
      for (const thread of threads) {
        const uuid = yield* crypto.randomUUIDv4;
        yield* orchestrationEngine.dispatch({
          type: "thread.settle",
          commandId: CommandId.make(`server:folder-archive:${uuid}`),
          threadId: thread.id,
        });
      }
    }).pipe(
      // Settling is housekeeping; the worktree is already gone.
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not settle threads of an archived folder worktree", cause),
      ),
    );

  const findMember = (manifest: FolderManifest, projectId: ProjectId) => {
    const member = manifest.members.find((candidate) => candidate.projectId === projectId);
    return member
      ? Effect.succeed(member)
      : fail("not_found", `Folder '${manifest.slug}' has no member for project '${projectId}'.`);
  };

  const replaceMember = (manifest: FolderManifest, next: FolderMember): FolderManifest => ({
    ...manifest,
    members: manifest.members.map((member) =>
      member.projectId === next.projectId ? next : member,
    ),
  });

  const archiveActiveMember = (member: FolderMember, force: boolean) =>
    Effect.gen(function* () {
      if (member.archivedAt !== null) return member;
      yield* removeMemberWorktree(member, force);
      yield* settleMemberThreads(member);
      return { ...member, archivedAt: yield* nowIso };
    });

  const restoreArchivedMember = (member: FolderMember) =>
    Effect.gen(function* () {
      if (member.archivedAt === null) return member;
      // A member whose project is gone stays archived rather than failing the
      // whole folder; adding the project back makes it restorable again.
      const projectRoot = yield* resolveProjectRoot(member.projectId).pipe(
        Effect.map((root): string | null => root),
        Effect.catchIf(
          (error) => error.reason === "project_not_found",
          () =>
            Effect.logWarning(
              `Cannot restore ${member.repoName}: project ${member.projectId} is gone.`,
            ).pipe(Effect.as(null)),
        ),
      );
      if (projectRoot === null) return member;
      const setup = yield* prepareWorktree({
        projectRoot,
        branch: member.branch,
        baseBranch: member.baseBranch,
        worktreePath: member.worktreePath,
      });
      return { ...member, archivedAt: null, setup };
    });

  const list: FolderService["Service"]["list"] = () =>
    Effect.gen(function* () {
      yield* ensureGuidesDir;
      const entries = yield* fs
        .readDirectory(foldersDir)
        .pipe(Effect.orElseSucceed(() => [] as string[]));
      const folders: Folder[] = [];
      for (const slug of entries) {
        const manifest = yield* readManifest(slug).pipe(
          Effect.map(Option.some),
          Effect.catch((error) =>
            error.reason === "not_found"
              ? Effect.succeed(Option.none<FolderManifest>())
              : Effect.logWarning(error.detail).pipe(Effect.as(Option.none<FolderManifest>())),
          ),
        );
        if (Option.isSome(manifest)) folders.push(toFolder(manifest.value));
      }
      folders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { foldersDir, guidesDir, folders };
    });

  const create: FolderService["Service"]["create"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const slug = slugifyFolderName(input.name);
        if (slug.length === 0) {
          return yield* fail("invalid_input", "Folder names need at least one letter or digit.");
        }
        const projectIds = input.members.map((member) => member.projectId);
        if (new Set(projectIds).size !== projectIds.length) {
          return yield* fail("invalid_input", "Each repository can join a folder only once.");
        }
        const folderDir = folderDirFor(slug);
        if (yield* fs.exists(folderDir).pipe(Effect.orElseSucceed(() => false))) {
          return yield* fail("already_exists", `A folder named '${slug}' already exists.`);
        }
        yield* ensureGuidesDir;
        const branch = input.branch ?? `feat/${slug}`;
        // Read the issue before touching disk, so a bad reference fails cleanly.
        const issueKey = input.issue === undefined ? null : parseIssueReference(input.issue);
        if (input.issue !== undefined && issueKey === null) {
          return yield* fail(
            "invalid_input",
            "Use a GitHub issue URL or owner/name#number for the issue.",
          );
        }
        const issue = issueKey === null ? null : yield* github.fetchIssue(issueKey);

        const scaffold = Effect.gen(function* () {
          const contextDir = path.join(folderDir, FOLDER_CONTEXT_DIR);
          for (const subdir of FOLDER_CONTEXT_SUBDIRS) {
            yield* fs.makeDirectory(path.join(contextDir, subdir), { recursive: true });
          }
          const files = folderContextScaffold({ name: input.name, guidesDir });
          for (const [name, contents] of Object.entries(files)) {
            yield* fs.writeFileString(path.join(contextDir, name), contents);
          }
          if (issue !== null) {
            yield* fs.writeFileString(
              path.join(contextDir, "issue.md"),
              renderIssueContext({ issue: issue.ref, parent: issue.parent, body: issue.body }),
            );
          }
        }).pipe(Effect.mapError(ioFailed(`Could not create ${folderDir}.`)));

        const created: FolderMember[] = [];
        const build = Effect.gen(function* () {
          yield* scaffold;
          for (const member of input.members) {
            created.push(
              yield* createMember({
                slug,
                branch,
                member,
                takenRepoNames: created.map((existing) => existing.repoName),
              }),
            );
          }
          return yield* writeManifest({
            version: 1,
            slug,
            name: input.name,
            createdAt: yield* nowIso,
            archivedAt: null,
            members: created,
            ...(issue === null
              ? {}
              : {
                  issue: {
                    ...issue.ref,
                    ...(issue.parent ? { parent: issue.parent } : {}),
                    status: null,
                  },
                }),
            ...(input.initialPrompt?.trim() ? { initialPrompt: input.initialPrompt.trim() } : {}),
          });
        });

        // A half-built folder is worse than none: undo worktrees and the directory.
        const folder = yield* build.pipe(
          Effect.onError(() =>
            Effect.forEach(
              created,
              (member) => removeMemberWorktree(member, true).pipe(Effect.ignore),
              {
                discard: true,
              },
            ).pipe(Effect.andThen(fs.remove(folderDir, { recursive: true }).pipe(Effect.ignore))),
          ),
        );
        return folder.issue ? yield* announceOnIssue(folder) : folder;
      }),
    );

  /**
   * Tell the issue which folder took it and mark it in progress. GitHub being
   * unreachable must not undo a folder that exists on disk, so failures log.
   */
  const announceOnIssue = (folder: Folder) =>
    Effect.gen(function* () {
      const issue = folder.issue!;
      const rows = folder.members.map(
        (member) => `| ${member.repoName} | \`${member.branch}\` from \`${member.baseBranch}\` |`,
      );
      yield* github.comment(
        issue,
        [
          `T3 Code folder **${folder.name}** is working on this issue.`,
          "",
          "| Repository | Branch |",
          "| --- | --- |",
          ...rows,
          "",
          `Open T3 Code and find **${folder.name}** under Folders.`,
        ].join("\n"),
      );
      yield* github.setStatus(issue, "in-progress");
      const { path: _path, contextDir: _contextDir, ...manifest } = folder;
      return yield* writeManifest({ ...manifest, issue: { ...issue, status: "in-progress" } });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not update the folder's GitHub issue", error).pipe(
          Effect.as(folder),
        ),
      ),
    );

  const setIssueStatus: FolderService["Service"]["setIssueStatus"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const manifest = yield* readManifest(input.slug);
        if (!manifest.issue) {
          return yield* fail("invalid_input", `Folder '${manifest.slug}' has no linked issue.`);
        }
        yield* github.setStatus(manifest.issue, input.status);
        return yield* writeManifest({
          ...manifest,
          issue: { ...manifest.issue, status: input.status },
        });
      }),
    );

  const addMember: FolderService["Service"]["addMember"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const manifest = yield* readManifest(input.slug);
        if (manifest.members.some((member) => member.projectId === input.member.projectId)) {
          return yield* fail("already_exists", "That repository is already in this folder.");
        }
        const branch = manifest.members[0]?.branch ?? `feat/${manifest.slug}`;
        const member = yield* createMember({
          slug: manifest.slug,
          branch,
          member: input.member,
          takenRepoNames: manifest.members.map((existing) => existing.repoName),
        });
        return yield* writeManifest({ ...manifest, members: [...manifest.members, member] });
      }),
    );

  const archiveMember: FolderService["Service"]["archiveMember"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const manifest = yield* readManifest(input.slug);
        const member = yield* findMember(manifest, input.projectId);
        const next = yield* archiveActiveMember(member, input.force === true);
        return yield* writeManifest(replaceMember(manifest, next));
      }),
    );

  const restoreMember: FolderService["Service"]["restoreMember"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const manifest = yield* readManifest(input.slug);
        const member = yield* findMember(manifest, input.projectId);
        const next = yield* restoreArchivedMember(member);
        return yield* writeManifest({ ...replaceMember(manifest, next), archivedAt: null });
      }),
    );

  const archive: FolderService["Service"]["archive"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        let manifest = yield* readManifest(input.slug);
        // Persist after each member so a dirty worktree midway keeps earlier progress.
        for (const member of manifest.members) {
          const next = yield* archiveActiveMember(member, input.force === true);
          if (next !== member) {
            manifest = replaceMember(manifest, next);
            yield* writeManifest(manifest);
          }
        }
        return yield* writeManifest({ ...manifest, archivedAt: yield* nowIso });
      }),
    );

  const restore: FolderService["Service"]["restore"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        let manifest = yield* readManifest(input.slug);
        for (const member of manifest.members) {
          const next = yield* restoreArchivedMember(member);
          if (next !== member) {
            manifest = replaceMember(manifest, next);
            yield* writeManifest(manifest);
          }
        }
        return yield* writeManifest({ ...manifest, archivedAt: null });
      }),
    );

  const copyEnvFiles: FolderService["Service"]["copyEnvFiles"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const manifest = yield* readManifest(input.slug);
        const member = yield* findMember(manifest, input.projectId);
        if (member.archivedAt !== null) {
          return yield* fail("invalid_input", `${member.repoName} is archived; restore it first.`);
        }
        const envFiles = yield* copyProjectEnvFiles({
          projectRoot: yield* resolveProjectRoot(member.projectId),
          worktreePath: member.worktreePath,
          overwrite: true,
        });
        return yield* writeManifest(
          replaceMember(manifest, {
            ...member,
            setup: { baseRef: member.setup?.baseRef ?? null, envFiles, at: yield* nowIso },
          }),
        );
      }),
    );

  const deleteFolder: FolderService["Service"]["delete"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const manifest = yield* readManifest(input.slug);
        for (const member of manifest.members) {
          if (member.archivedAt !== null) continue;
          yield* removeMemberWorktree(member, input.force === true);
          yield* settleMemberThreads(member);
        }
        // The manifest goes with the directory, so `.context` notes go too.
        yield* fs
          .remove(folderDirFor(manifest.slug), { recursive: true })
          .pipe(Effect.mapError(ioFailed(`Could not delete ${folderDirFor(manifest.slug)}.`)));
        return { slug: manifest.slug };
      }),
    );

  const writeHandoff: FolderService["Service"]["writeHandoff"] = (input) =>
    Effect.gen(function* () {
      const thread = yield* snapshotQuery
        .getThreadDetailById(input.threadId, { activityKinds: [] })
        .pipe(
          Effect.mapError(ioFailed("Could not read the thread.")),
          Effect.flatMap(
            Option.match({
              onNone: () => fail("not_found", `Thread '${input.threadId}' was not found.`),
              onSome: Effect.succeed,
            }),
          ),
        );
      const scope = resolveFolderScope(thread.worktreePath ?? undefined, foldersDir);
      if (scope === null) {
        return yield* fail("not_in_folder", "Handoffs are available for threads in a folder.");
      }
      const manifest = yield* readManifest(scope.slug);
      const writtenAt = yield* nowIso;
      const filePath = path.join(
        scope.contextDir,
        "handoffs",
        handoffFileName(thread.title, writtenAt),
      );
      const contents = buildHandoffMarkdown({
        thread,
        folderName: manifest.name,
        member:
          manifest.members.find((member) => member.worktreePath === thread.worktreePath) ?? null,
        writtenAt,
      });
      yield* fs
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(
          Effect.andThen(fs.writeFileString(filePath, contents)),
          Effect.mapError(ioFailed(`Could not write ${filePath}.`)),
        );
      return { path: filePath };
    });

  return FolderService.of({
    list,
    create,
    addMember,
    archiveMember,
    restoreMember,
    archive,
    restore,
    setIssueStatus,
    delete: deleteFolder,
    copyEnvFiles,
    writeHandoff,
  });
});

export const layer = Layer.effect(FolderService, make);
