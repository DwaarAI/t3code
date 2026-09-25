/**
 * Built-in skills ship inside the server (see `apps/server/builtin-skills`) and are
 * written to the skills directory as a Claude Code plugin named `t3`:
 *
 *   <skillsDir>/.claude-plugin/plugin.json
 *   <skillsDir>/skills/<name>/SKILL.md, scripts/, ...
 *
 * Claude loads the directory through the Agent SDK `plugins` option and Codex
 * through `skills/extraRoots/set`. Both namespace the skills by the plugin
 * name, so a skill is invoked as `$t3:<name>` everywhere. Nothing is written
 * to the user's own `~/.claude` or `~/.codex`.
 *
 * @module skills/builtinSkills
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { BUILTIN_SKILL_FILES, type BuiltinSkillFile } from "./builtinSkills.gen.ts";

export const BUILTIN_SKILLS_PLUGIN_NAME = "t3";

/** Marks a directory under `skills/` as server-owned, so it is replaced on every start. */
const BUILTIN_SKILL_MARKER = ".t3-builtin";

/** The name agents and the `$` picker use for a built-in skill. */
export const builtinSkillCommandName = (name: string) => `${BUILTIN_SKILLS_PLUGIN_NAME}:${name}`;

const PLUGIN_MANIFEST = `{
  "name": "${BUILTIN_SKILLS_PLUGIN_NAME}",
  "description": "Skills built into T3 Code."
}
`;

/**
 * Rewrite the built-in skills from the copy embedded in this server build.
 * Earlier built-ins, including ones a newer build dropped, are removed first,
 * so the directory always matches the running server. Skill directories
 * without the marker are left alone.
 */
export const installBuiltinSkills = Effect.fn("installBuiltinSkills")(function* (
  dirs: { readonly skillsDir: string; readonly skillRootsDir: string },
  files: ReadonlyArray<BuiltinSkillFile> = BUILTIN_SKILL_FILES,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootsDir = dirs.skillRootsDir;

  yield* fs.makeDirectory(path.join(dirs.skillsDir, ".claude-plugin"), { recursive: true });
  yield* fs.writeFileString(
    path.join(dirs.skillsDir, ".claude-plugin", "plugin.json"),
    PLUGIN_MANIFEST,
  );

  yield* fs.makeDirectory(rootsDir, { recursive: true });
  for (const entry of yield* fs.readDirectory(rootsDir)) {
    const dir = path.join(rootsDir, entry);
    if (yield* fs.exists(path.join(dir, BUILTIN_SKILL_MARKER))) {
      yield* fs.remove(dir, { recursive: true });
    }
  }

  const names = new Set<string>();
  for (const file of files) {
    const target = path.join(rootsDir, ...file.path.split("/"));
    names.add(file.path.split("/")[0] ?? "");
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.writeFileString(target, file.contents);
    if (file.executable) yield* fs.chmod(target, 0o755);
  }
  for (const name of names) {
    yield* fs.writeFileString(path.join(rootsDir, name, BUILTIN_SKILL_MARKER), "");
  }
});
