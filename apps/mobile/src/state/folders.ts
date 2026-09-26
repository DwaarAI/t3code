import { useAtomValue } from "@effect/atom-react";
import { createFolderEnvironmentAtoms } from "@t3tools/client-runtime/state/folders";
import type { EnvironmentId, Folder } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atom-registry";
import { environmentServerConfigsAtom } from "./server";

export const folderEnvironment = createFolderEnvironmentAtoms(connectionAtomRuntime);

export interface EnvironmentFolders {
  readonly environmentId: EnvironmentId;
  readonly folders: ReadonlyArray<Folder>;
}

const EMPTY_FOLDERS: ReadonlyArray<EnvironmentFolders> = Object.freeze([]);

/** Folders of every connected environment whose server supports them. */
const environmentFoldersAtom = Atom.make((get): ReadonlyArray<EnvironmentFolders> => {
  const result: EnvironmentFolders[] = [];
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    if (config.environment.capabilities.folders !== true) continue;
    const listed = Option.getOrNull(
      AsyncResult.value(get(folderEnvironment.list({ environmentId, input: {} }))),
    );
    if (listed !== null) result.push({ environmentId, folders: listed.folders });
  }
  return result.length === 0 ? EMPTY_FOLDERS : result;
}).pipe(Atom.withLabel("mobile-folders:all"));

const foldersSupportedAtom = Atom.make((get) => {
  for (const config of get(environmentServerConfigsAtom).values()) {
    if (config.environment.capabilities.folders === true) return true;
  }
  return false;
}).pipe(Atom.withLabel("mobile-folders:supported"));

/** Folders are read with a query rather than streamed, so screens refresh them on demand. */
export function refreshFolders(): void {
  for (const [environmentId, config] of appAtomRegistry.get(environmentServerConfigsAtom)) {
    if (config.environment.capabilities.folders !== true) continue;
    appAtomRegistry.refresh(folderEnvironment.list({ environmentId, input: {} }));
  }
}

export function useEnvironmentFolders(): ReadonlyArray<EnvironmentFolders> {
  return useAtomValue(environmentFoldersAtom);
}

/** Whether any connected environment can hold folders, to decide if the entry point shows. */
export function useFoldersSupported(): boolean {
  return useAtomValue(foldersSupportedAtom);
}

export function useFolder(environmentId: EnvironmentId, slug: string): Folder | null {
  const all = useEnvironmentFolders();
  return useMemo(
    () =>
      all
        .find((entry) => entry.environmentId === environmentId)
        ?.folders.find((folder) => folder.slug === slug) ?? null,
    [all, environmentId, slug],
  );
}
