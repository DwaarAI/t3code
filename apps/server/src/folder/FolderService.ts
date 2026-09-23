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

  /** Check out `branch` at `worktreePath`, creating the branch from base when missing. */
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
      yield* gitWorkflow.createWorktree(
        branchExists
          ? { cwd: input.projectRoot, refName: input.branch, path: input.worktreePath }
          : {
              cwd: input.projectRoot,
              refName: input.baseBranch,
              newRefName: input.branch,
              baseRefName: input.baseBranch,
              path: input.worktreePath,
            },
      );
    }).pipe(Effect.mapError(gitFailed));

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
      yield* checkOutWorktree({
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
      } satisfies FolderMember;
    });

  const removeMemberWorktree = (member: FolderMember, force: boolean) =>
    Effect.gen(function* () {
      const projectRoot = yield* resolveProjectRoot(member.projectId);
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
      yield* checkOutWorktree({
        projectRoot: yield* resolveProjectRoot(member.projectId),
        branch: member.branch,
        baseBranch: member.baseBranch,
        worktreePath: member.worktreePath,
      });
      return { ...member, archivedAt: null };
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
    writeHandoff,
  });
});

export const layer = Layer.effect(FolderService, make);
