import type { EnvironmentId } from "@t3tools/contracts";

export interface ComposerPathSearchEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly parentPath?: string;
  /** Set for entries found outside the workspace, such as shared guides; `path` is absolute. */
  readonly sourceLabel?: string;
}

export interface ComposerPathSearchState {
  readonly entries: ReadonlyArray<ComposerPathSearchEntry>;
  readonly isPending: boolean;
  readonly error: string | null;
}

export interface ComposerPathSearchTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string | null;
}

/** A directory outside the workspace whose files can be attached, such as shared guides. */
export interface ComposerExtraSearchRoot {
  readonly cwd: string;
  readonly label: string;
}

const EXTRA_ROOT_RESULT_LIMIT = 5;

/**
 * Turns a search inside an extra root into absolute file entries labelled with
 * the root and the file's folder within it, so they read apart from workspace files.
 */
export function extraRootPathEntries(
  root: ComposerExtraSearchRoot,
  entries: ReadonlyArray<Pick<ComposerPathSearchEntry, "path" | "kind">>,
): ComposerPathSearchEntry[] {
  const separator = root.cwd.includes("\\") && !root.cwd.includes("/") ? "\\" : "/";
  const base = root.cwd.replace(/[\\/]+$/, "");
  return entries
    .filter((entry) => entry.kind === "file")
    .slice(0, EXTRA_ROOT_RESULT_LIMIT)
    .map((entry) => ({
      path: `${base}${separator}${entry.path}`,
      kind: entry.kind,
      sourceLabel: [root.label, entry.path.split(/[\\/]/).slice(0, -1).join("/")]
        .filter(Boolean)
        .join("/"),
    }));
}
