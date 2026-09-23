import { useAtomValue } from "@effect/atom-react";
import {
  createFolderEnvironmentAtoms,
  findFolderMemberForWorktree,
  type FolderWorktreeMatch,
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

/** The folder and member a worktree belongs to, or null outside folders. */
export function useFolderMemberForWorktree(
  environmentId: EnvironmentId | null,
  worktreePath: string | null | undefined,
): (FolderWorktreeMatch & { readonly environment: EnvironmentFolders }) | null {
  const environment = useFoldersForEnvironment(environmentId);
  return useMemo(() => {
    if (environment === null) return null;
    const match = findFolderMemberForWorktree(environment.folders, worktreePath);
    return match ? { ...match, environment } : null;
  }, [environment, worktreePath]);
}

/** Every folder member worktree path, keyed by environment, for filtering thread lists. */
export function useFolderWorktreeKeys(): ReadonlySet<string> {
  const all = useEnvironmentFolders();
  return useMemo(() => {
    const keys = new Set<string>();
    for (const environment of all) {
      for (const folder of environment.folders) {
        for (const member of folder.members) {
          keys.add(folderWorktreeKey(environment.environmentId, member.worktreePath));
        }
      }
    }
    return keys;
  }, [all]);
}

export function isFolderWorktree(
  all: ReadonlyArray<EnvironmentFolders>,
  environmentId: EnvironmentId,
  worktreePath: string | null | undefined,
): boolean {
  const environment = all.find((entry) => entry.environmentId === environmentId);
  return (
    environment !== undefined &&
    findFolderMemberForWorktree(environment.folders, worktreePath) !== null
  );
}

export function folderWorktreeKey(environmentId: EnvironmentId, worktreePath: string): string {
  return `${environmentId}\u0000${worktreePath}`;
}
