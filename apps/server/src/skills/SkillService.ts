/**
 * SkillService — lists and edits the skills under `<T3 home>/skills`.
 *
 * Enabled skills live in `skills/<name>/`, the `t3` plugin's skill directory
 * that Claude and Codex sessions load (see `builtinSkills.ts`). Disabled custom
 * skills move to `disabled/<name>/`, which no provider reads. Built-in skills
 * carry a marker file and are rewritten on every start, so only custom skills
 * can be saved, disabled, or deleted.
 *
 * @module skills/SkillService
 */
import {
  SKILL_ENTRY_FILE,
  SKILL_MAX_FILES,
  SKILL_MAX_TOTAL_BYTES,
  type Skill,
  SkillError,
  type SkillFile,
  type SkillFileInfo,
  type SkillRefInput,
  type SkillsGetResult,
  type SkillsListResult,
  type SkillsSaveInput,
  type SkillsSetEnabledInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import { parseSkillFrontmatter } from "../provider/Drivers/ClaudeSkills.ts";
import {
  BUILTIN_SKILL_MARKER,
  builtinSkillCommandName,
  builtinSkillNames,
} from "./builtinSkills.ts";

export class SkillService extends Context.Service<
  SkillService,
  {
    readonly list: () => Effect.Effect<SkillsListResult, SkillError>;
    readonly get: (input: SkillRefInput) => Effect.Effect<SkillsGetResult, SkillError>;
    /** Creates, replaces, or renames a custom skill with exactly the given files. */
    readonly save: (input: SkillsSaveInput) => Effect.Effect<Skill, SkillError>;
    readonly delete: (input: SkillRefInput) => Effect.Effect<SkillRefInput, SkillError>;
    readonly setEnabled: (input: SkillsSetEnabledInput) => Effect.Effect<Skill, SkillError>;
  }
>()("t3/skills/SkillService") {}

const fail = (reason: SkillError["reason"], detail: string) =>
  Effect.fail(new SkillError({ reason, detail }));

const ioFailed = (detail: string) => (cause: unknown) =>
  new SkillError({ reason: "io_failed", detail, cause });

const textEncoder = new TextEncoder();

/**
 * The error for the first file a save must not write, if any. Paths are
 * relative POSIX paths that stay inside the skill folder.
 */
export function validateSkillFiles(files: ReadonlyArray<SkillFile>): string | null {
  const entry = files.find((file) => file.path === SKILL_ENTRY_FILE);
  if (entry === undefined) {
    return `A skill needs a ${SKILL_ENTRY_FILE} at its top level.`;
  }
  // Codex skips skills without a description, and both providers show it in
  // their skill lists, so a skill without one would silently go missing.
  const frontmatter = parseSkillFrontmatter(entry.contents);
  if (frontmatter.kind !== "parsed" || !frontmatter.description?.trim()) {
    return `${SKILL_ENTRY_FILE} needs a description in its frontmatter (--- description: ... ---).`;
  }
  if (files.length > SKILL_MAX_FILES) {
    return `A skill can hold at most ${SKILL_MAX_FILES} files.`;
  }
  let totalBytes = 0;
  const seen = new Set<string>();
  for (const file of files) {
    const segments = file.path.split("/");
    if (
      file.path.includes("\\") ||
      file.path.includes("\0") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      return `'${file.path}' is not a relative path inside the skill.`;
    }
    if (segments.includes(BUILTIN_SKILL_MARKER)) {
      return `'${file.path}' uses a name reserved for built-in skills.`;
    }
    if (seen.has(file.path)) return `'${file.path}' is listed twice.`;
    seen.add(file.path);
    totalBytes += textEncoder.encode(file.contents).byteLength;
  }
  if (totalBytes > SKILL_MAX_TOTAL_BYTES) {
    return `A skill can hold at most ${Math.floor(SKILL_MAX_TOTAL_BYTES / 1000)} KB of files.`;
  }
  return null;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const enabledDir = serverConfig.skillRootsDir;
  const disabledDir = path.join(serverConfig.skillsDir, "disabled");
  const stagingDir = path.join(serverConfig.skillsDir, ".staging");
  const builtinNames = builtinSkillNames();
  // Saves stage a folder and swap it in; one at a time keeps renames simple.
  const mutation = yield* Semaphore.make(1);

  const listFiles = (dir: string) =>
    Effect.gen(function* () {
      const files: Array<SkillFileInfo & { readonly absolute: string }> = [];
      for (const entry of (yield* fs.readDirectory(dir, { recursive: true })).toSorted()) {
        const absolute = path.join(dir, entry);
        const info = yield* fs.stat(absolute);
        const relative = entry.split(path.sep).join("/");
        if (info.type !== "File" || relative === BUILTIN_SKILL_MARKER) continue;
        files.push({
          path: relative,
          sizeBytes: Number(info.size),
          executable: (info.mode & 0o111) !== 0,
          absolute,
        });
      }
      return files;
    });

  const readSkill = (dir: string, name: string, enabled: boolean) =>
    Effect.gen(function* () {
      const files = yield* listFiles(dir);
      const entry = yield* fs
        .readFileString(path.join(dir, SKILL_ENTRY_FILE))
        .pipe(Effect.orElseSucceed(() => ""));
      const frontmatter = parseSkillFrontmatter(entry);
      const builtin = yield* fs.exists(path.join(dir, BUILTIN_SKILL_MARKER));
      const skill: Skill = {
        name,
        commandName: builtinSkillCommandName(name),
        description: frontmatter.kind === "parsed" ? (frontmatter.description ?? null) : null,
        source: builtin ? "builtin" : "custom",
        enabled,
        files: files.map(({ absolute: _absolute, ...info }) => info),
      };
      return { skill, files };
    });

  /** Where a skill lives now, preferring its enabled copy. */
  const locate = (name: string) =>
    Effect.gen(function* () {
      const enabledPath = path.join(enabledDir, name);
      if (yield* fs.exists(path.join(enabledPath, SKILL_ENTRY_FILE))) {
        return { dir: enabledPath, enabled: true } as const;
      }
      const disabledPath = path.join(disabledDir, name);
      if (yield* fs.exists(path.join(disabledPath, SKILL_ENTRY_FILE))) {
        return { dir: disabledPath, enabled: false } as const;
      }
      return null;
    }).pipe(Effect.mapError(ioFailed(`Could not look up skill '${name}'.`)));

  const locateCustom = (name: string) =>
    Effect.gen(function* () {
      const location = yield* locate(name);
      if (location === null) return yield* fail("not_found", `Skill '${name}' does not exist.`);
      const builtin = yield* fs
        .exists(path.join(location.dir, BUILTIN_SKILL_MARKER))
        .pipe(Effect.mapError(ioFailed(`Could not look up skill '${name}'.`)));
      if (builtin) {
        return yield* fail("builtin", `'${name}' is built in; duplicate it to change it.`);
      }
      return location;
    });

  const list: SkillService["Service"]["list"] = () =>
    Effect.gen(function* () {
      const skills: Array<Skill> = [];
      for (const [dir, enabled] of [
        [enabledDir, true],
        [disabledDir, false],
      ] as const) {
        const entries = yield* fs
          .readDirectory(dir)
          .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
        for (const name of entries.toSorted()) {
          if (!(yield* fs.exists(path.join(dir, name, SKILL_ENTRY_FILE)))) continue;
          skills.push((yield* readSkill(path.join(dir, name), name, enabled)).skill);
        }
      }
      return {
        skillsDir: serverConfig.skillsDir,
        skills: skills.toSorted((left, right) => left.name.localeCompare(right.name)),
      };
    }).pipe(Effect.mapError(ioFailed("Could not list skills.")));

  const get: SkillService["Service"]["get"] = (input) =>
    Effect.gen(function* () {
      const location = yield* locate(input.name);
      if (location === null) {
        return yield* fail("not_found", `Skill '${input.name}' does not exist.`);
      }
      const { skill, files } = yield* readSkill(location.dir, input.name, location.enabled).pipe(
        Effect.mapError(ioFailed(`Could not read skill '${input.name}'.`)),
      );
      const contents: Array<SkillFile> = [];
      for (const file of files) {
        contents.push({
          path: file.path,
          executable: file.executable,
          contents: yield* fs
            .readFileString(file.absolute)
            .pipe(Effect.mapError(ioFailed(`Could not read ${file.path}.`))),
        });
      }
      return { skill, files: contents };
    });

  const save: SkillService["Service"]["save"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const invalid = validateSkillFiles(input.files);
        if (invalid !== null) return yield* fail("invalid_input", invalid);
        if (builtinNames.has(input.name)) {
          return yield* fail("already_exists", `'${input.name}' is the name of a built-in skill.`);
        }
        const previous =
          input.previousName === undefined ? null : yield* locateCustom(input.previousName);
        if (input.previousName !== input.name && (yield* locate(input.name)) !== null) {
          return yield* fail("already_exists", `A skill named '${input.name}' already exists.`);
        }
        const target = path.join(
          previous?.enabled === false ? disabledDir : enabledDir,
          input.name,
        );

        const stagingId = yield* crypto.randomUUIDv4.pipe(
          Effect.mapError(ioFailed("Could not generate a staging id.")),
        );
        const staged = path.join(stagingDir, `${input.name}-${stagingId}`);
        yield* Effect.gen(function* () {
          for (const file of input.files) {
            const filePath = path.join(staged, ...file.path.split("/"));
            yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
            yield* fs.writeFileString(filePath, file.contents);
            if (file.executable || file.contents.startsWith("#!")) {
              yield* fs.chmod(filePath, 0o755);
            }
          }
          if (previous !== null) yield* fs.remove(previous.dir, { recursive: true });
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          yield* fs.rename(staged, target);
        }).pipe(
          Effect.ensuring(fs.remove(staged, { recursive: true, force: true }).pipe(Effect.ignore)),
          Effect.mapError(ioFailed(`Could not save skill '${input.name}'.`)),
        );
        return (yield* readSkill(target, input.name, previous?.enabled ?? true).pipe(
          Effect.mapError(ioFailed(`Could not read skill '${input.name}'.`)),
        )).skill;
      }),
    );

  const deleteSkill: SkillService["Service"]["delete"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const location = yield* locateCustom(input.name);
        yield* fs
          .remove(location.dir, { recursive: true })
          .pipe(Effect.mapError(ioFailed(`Could not delete skill '${input.name}'.`)));
        return { name: input.name };
      }),
    );

  const setEnabled: SkillService["Service"]["setEnabled"] = (input) =>
    mutation.withPermits(1)(
      Effect.gen(function* () {
        const location = yield* locateCustom(input.name);
        const target = path.join(input.enabled ? enabledDir : disabledDir, input.name);
        if (location.enabled !== input.enabled) {
          if (yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))) {
            return yield* fail(
              "already_exists",
              `Another skill named '${input.name}' is already ${input.enabled ? "enabled" : "disabled"}.`,
            );
          }
          yield* fs
            .makeDirectory(path.dirname(target), { recursive: true })
            .pipe(
              Effect.andThen(fs.rename(location.dir, target)),
              Effect.mapError(ioFailed(`Could not move skill '${input.name}'.`)),
            );
        }
        return (yield* readSkill(target, input.name, input.enabled).pipe(
          Effect.mapError(ioFailed(`Could not read skill '${input.name}'.`)),
        )).skill;
      }),
    );

  return SkillService.of({ list, get, save, delete: deleteSkill, setEnabled });
});

export const layer = Layer.effect(SkillService, make);
