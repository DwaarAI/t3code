import {
  type ComposerPathSearchEntry,
  type ComposerPathSearchState,
  type ComposerPathSearchTarget,
} from "@t3tools/client-runtime/state/threads";

import { useComposerPathSearch as useComposerPathSearchQuery } from "../state/queries";

/** A directory outside the workspace whose files can be attached, such as shared guides. */
export interface ComposerExtraSearchRoot {
  readonly cwd: string;
  readonly label: string;
}

const EXTRA_ROOT_RESULT_LIMIT = 5;

function useExtraRootEntries(
  target: ComposerPathSearchTarget,
  root: ComposerExtraSearchRoot | null,
) {
  const state = useComposerPathSearchQuery({
    environmentId: target.environmentId,
    cwd: root !== null && target.cwd !== null ? root.cwd : null,
    query: target.query,
  });
  if (root === null) return { entries: [], isPending: false };
  const separator = root.cwd.includes("\\") && !root.cwd.includes("/") ? "\\" : "/";
  const entries: ComposerPathSearchEntry[] = state.entries
    .filter((entry) => entry.kind === "file")
    .slice(0, EXTRA_ROOT_RESULT_LIMIT)
    .map((entry) => ({
      path: `${root.cwd.replace(/[\\/]+$/, "")}${separator}${entry.path}`,
      kind: entry.kind,
      sourceLabel: [root.label, entry.path.split(/[\\/]/).slice(0, -1).join("/")]
        .filter(Boolean)
        .join("/"),
    }));
  return { entries, isPending: state.isPending };
}

export function useComposerPathSearch(
  target: ComposerPathSearchTarget,
  extraRoots: {
    readonly context: ComposerExtraSearchRoot | null;
    readonly guides: ComposerExtraSearchRoot | null;
  } = { context: null, guides: null },
): ComposerPathSearchState {
  const state = useComposerPathSearchQuery(target);
  // Shared notes and guides are few and deliberate, so they list first.
  const context = useExtraRootEntries(target, extraRoots.context);
  const guides = useExtraRootEntries(target, extraRoots.guides);
  return {
    entries: [
      ...context.entries,
      ...guides.entries,
      ...state.entries.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
      })),
    ],
    error: state.error,
    isPending: state.isPending || context.isPending || guides.isPending,
  };
}
