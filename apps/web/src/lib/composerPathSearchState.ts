import {
  type ComposerExtraSearchRoot,
  type ComposerPathSearchState,
  type ComposerPathSearchTarget,
  extraRootPathEntries,
} from "@t3tools/client-runtime/state/threads";

import { useComposerPathSearch as useComposerPathSearchQuery } from "../state/queries";

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
  return { entries: extraRootPathEntries(root, state.entries), isPending: state.isPending };
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
