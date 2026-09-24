import { useAtomValue } from "@effect/atom-react";
import {
  createFolderEnvironmentAtoms,
  findFolderForCwd,
  findFolderForThread,
  findFolderMemberForWorktree,
  type FolderThreadMatch,
} from "@t3tools/client-runtime/state/folders";
import type { EnvironmentId, Folder } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readThreadShells } from "./entities";
import { environmentServerConfigsAtom } from "./server";

export const folderEnvironment = createFolderEnvironmentAtoms(connectionAtomRuntime);

export interface EnvironmentFolders {
  readonly environmentId: EnvironmentId;
  readonly foldersDir: string;
  readonly guidesDir: string;
  readonly folders: ReadonlyArray<Folder>;
}

const EMPTY_FOLDERS: ReadonlyArray<EnvironmentFolders> = Object.freeze([]);

/** Folders of every connected environment that supports them. */
const environmentFoldersAtom = Atom.make((get): ReadonlyArray<EnvironmentFolders> => {
  const result: EnvironmentFolders[] = [];
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    if (config.environment.capabilities.folders !== true) continue;
    const listed = Option.getOrNull(
      AsyncResult.value(get(folderEnvironment.list({ environmentId, input: {} }))),
    );
    if (listed !== null) result.push({ environmentId, ...listed });
  }
  return result.length === 0 ? EMPTY_FOLDERS : result;
}).pipe(Atom.withLabel("web-folders:all"));

/**
 * A draft's first send in a fresh folder worktree runs the project's setup
 * script, as creating a worktree from the composer does. Read at send time so
 * the chat view does not subscribe to every thread shell.
 */
export function readNeedsFolderWorktreeSetup(
  environmentId: EnvironmentId,
  worktreePath: string | null,
): boolean {
  if (!worktreePath) return false;
  const environment = appAtomRegistry
    .get(environmentFoldersAtom)
    .find((entry) => entry.environmentId === environmentId);
  if (!environment || !findFolderMemberForWorktree(environment.folders, worktreePath)) {
    return false;
  }
  return !readThreadShells().some(
    (thread) => thread.environmentId === environmentId && thread.worktreePath === worktreePath,
  );
}

export function useEnvironmentFolders(): ReadonlyArray<EnvironmentFolders> {
  return useAtomValue(environmentFoldersAtom);
}

export function useFoldersForEnvironment(
  environmentId: EnvironmentId | null,
): EnvironmentFolders | null {
  const all = useEnvironmentFolders();
  return useMemo(
    () => all.find((entry) => entry.environmentId === environmentId) ?? null,
    [all, environmentId],
  );
}

/** The folder a thread belongs to (null member for a folder session), or null outside folders. */
export function useFolderForThread(
  environmentId: EnvironmentId | null,
  projectId: string | null,
  worktreePath: string | null | undefined,
): (FolderThreadMatch & { readonly environment: EnvironmentFolders }) | null {
  const environment = useFoldersForEnvironment(environmentId);
  return useMemo(() => {
    if (environment === null || projectId === null) return null;
    const match = findFolderForThread(environment.folders, { projectId, worktreePath });
    return match ? { ...match, environment } : null;
  }, [environment, projectId, worktreePath]);
}

/** The folder whose member worktree or own directory is `cwd`. */
export function useFolderForCwd(
  environmentId: EnvironmentId | null,
  cwd: string | null | undefined,
): (FolderThreadMatch & { readonly environment: EnvironmentFolders }) | null {
  const environment = useFoldersForEnvironment(environmentId);
  return useMemo(() => {
    if (environment === null) return null;
    const match = findFolderForCwd(environment.folders, cwd);
    return match ? { ...match, environment } : null;
  }, [cwd, environment]);
}

/**
 * Keys for every folder member worktree and folder session project, so thread
 * lists can leave folder threads to the Folders section. See `isFolderThreadKey`.
 */
export function useFolderThreadKeys(): ReadonlySet<string> {
  const all = useEnvironmentFolders();
  return useMemo(() => {
    const keys = new Set<string>();
    for (const environment of all) {
      for (const folder of environment.folders) {
        for (const member of folder.members) {
          keys.add(`${environment.environmentId}\u0000${member.worktreePath}`);
        }
        if (folder.rootProjectId) {
          keys.add(`${environment.environmentId}\u0000project:${folder.rootProjectId}`);
        }
      }
    }
    return keys;
  }, [all]);
}

export function isFolderThreadKey(
  keys: ReadonlySet<string>,
  thread: {
    readonly environmentId: EnvironmentId;
    readonly projectId: string;
    readonly worktreePath: string | null;
  },
): boolean {
  return thread.worktreePath === null
    ? keys.has(`${thread.environmentId}\u0000project:${thread.projectId}`)
    : keys.has(`${thread.environmentId}\u0000${thread.worktreePath}`);
}

export function isFolderThread(
  all: ReadonlyArray<EnvironmentFolders>,
  environmentId: EnvironmentId,
  thread: { readonly projectId: string; readonly worktreePath: string | null | undefined },
): boolean {
  const environment = all.find((entry) => entry.environmentId === environmentId);
  return environment !== undefined && findFolderForThread(environment.folders, thread) !== null;
}
