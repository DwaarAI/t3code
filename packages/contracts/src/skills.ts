import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Skills are folders holding a `SKILL.md` plus any scripts or references. The
 * server keeps them under `<T3 home>/skills` and loads them into Claude and
 * Codex sessions as the `t3` plugin, so each is invoked as `$t3:<name>`.
 * Built-in skills ship with the server; custom skills are managed here.
 */
export const SkillName = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/));
export type SkillName = typeof SkillName.Type;

/** The only file every skill needs. */
export const SKILL_ENTRY_FILE = "SKILL.md";
/** Skills are text; these bound what one save may write. */
export const SKILL_MAX_FILES = 200;
export const SKILL_MAX_TOTAL_BYTES = 1_000_000;

export const SkillSource = Schema.Literals(["builtin", "custom"]);
export type SkillSource = typeof SkillSource.Type;

export const SkillFileInfo = Schema.Struct({
  /** POSIX path inside the skill folder, such as `scripts/deploy.sh`. */
  path: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  executable: Schema.Boolean,
});
export type SkillFileInfo = typeof SkillFileInfo.Type;

export const SkillFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  contents: Schema.String,
  /** Scripts starting with `#!` are made executable even when this is false. */
  executable: Schema.Boolean,
});
export type SkillFile = typeof SkillFile.Type;

export const Skill = Schema.Struct({
  name: SkillName,
  /** What agents and the `$` picker use, such as `t3:deploy`. */
  commandName: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  source: SkillSource,
  /** Disabled custom skills stay on disk but are hidden from every provider. */
  enabled: Schema.Boolean,
  files: Schema.Array(SkillFileInfo),
});
export type Skill = typeof Skill.Type;

export const SkillsListInput = Schema.Struct({});
export type SkillsListInput = typeof SkillsListInput.Type;

export const SkillsListResult = Schema.Struct({
  skillsDir: TrimmedNonEmptyString,
  skills: Schema.Array(Skill),
});
export type SkillsListResult = typeof SkillsListResult.Type;

export const SkillRefInput = Schema.Struct({ name: SkillName });
export type SkillRefInput = typeof SkillRefInput.Type;

export const SkillsGetResult = Schema.Struct({
  skill: Skill,
  files: Schema.Array(SkillFile),
});
export type SkillsGetResult = typeof SkillsGetResult.Type;

export const SkillsSaveInput = Schema.Struct({
  name: SkillName,
  /** The custom skill being edited; omit to create. A different `name` renames it. */
  previousName: Schema.optional(SkillName),
  /** The skill's complete contents; files not listed are removed. */
  files: Schema.Array(SkillFile),
});
export type SkillsSaveInput = typeof SkillsSaveInput.Type;

export const SkillResult = Schema.Struct({ skill: Skill });
export type SkillResult = typeof SkillResult.Type;

export const SkillsSetEnabledInput = Schema.Struct({
  name: SkillName,
  enabled: Schema.Boolean,
});
export type SkillsSetEnabledInput = typeof SkillsSetEnabledInput.Type;

export const SkillErrorReason = Schema.Literals([
  "not_found",
  "already_exists",
  "invalid_input",
  "builtin",
  "io_failed",
]);
export type SkillErrorReason = typeof SkillErrorReason.Type;

export class SkillError extends Schema.TaggedError<SkillError>()("SkillError", {
  reason: SkillErrorReason,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
