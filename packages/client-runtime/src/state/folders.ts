import { type EnvironmentId, type Folder, type FolderMember, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/**
 * Feature folders group one worktree per repository. The server keeps them on
 * disk, so clients read them with a query and refresh it after each mutation.
 */
export function createFolderEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:folders:list",
    tag: WS_METHODS.foldersList,
    staleTimeMs: 15_000,
  });
  const scheduler = createAtomCommandScheduler();
  // Every folder mutation rewrites the same manifest directory; run them in order.
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: EnvironmentId }) => environmentId,
  };
  const refreshList = (
    target: { readonly environmentId: EnvironmentId },
    registry: { readonly refresh: (atom: Atom.Atom<unknown>) => void },
  ) =>
    Effect.sync(() => registry.refresh(list({ environmentId: target.environmentId, input: {} })));

  const mutation = <TTag extends MutationTag>(tag: TTag, name: string) =>
    createEnvironmentRpcCommand(runtime, {
      label: `environment-data:folders:${name}`,
      tag,
      scheduler,
      concurrency,
      onSettled: refreshList,
    });

  return {
    list,
    create: mutation(WS_METHODS.foldersCreate, "create"),
    addMember: mutation(WS_METHODS.foldersAddMember, "add-member"),
    archiveMember: mutation(WS_METHODS.foldersArchiveMember, "archive-member"),
    restoreMember: mutation(WS_METHODS.foldersRestoreMember, "restore-member"),
    archive: mutation(WS_METHODS.foldersArchive, "archive"),
    restore: mutation(WS_METHODS.foldersRestore, "restore"),
    setIssueStatus: mutation(WS_METHODS.foldersSetIssueStatus, "set-issue-status"),
    delete: mutation(WS_METHODS.foldersDelete, "delete"),
    writeHandoff: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:folders:write-handoff",
      tag: WS_METHODS.foldersWriteHandoff,
    }),
  };
}

type MutationTag =
  | typeof WS_METHODS.foldersCreate
  | typeof WS_METHODS.foldersAddMember
  | typeof WS_METHODS.foldersArchiveMember
  | typeof WS_METHODS.foldersRestoreMember
  | typeof WS_METHODS.foldersArchive
  | typeof WS_METHODS.foldersRestore
  | typeof WS_METHODS.foldersSetIssueStatus
  | typeof WS_METHODS.foldersDelete;

export interface FolderWorktreeMatch {
  readonly folder: Folder;
  readonly member: FolderMember;
}

/** The folder member whose worktree a thread runs in, if any. */
export function findFolderMemberForWorktree(
  folders: ReadonlyArray<Folder>,
  worktreePath: string | null | undefined,
): FolderWorktreeMatch | null {
  if (!worktreePath) return null;
  for (const folder of folders) {
    const member = folder.members.find((candidate) => candidate.worktreePath === worktreePath);
    if (member) return { folder, member };
  }
  return null;
}
