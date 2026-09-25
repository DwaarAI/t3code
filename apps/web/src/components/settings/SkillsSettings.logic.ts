import { SKILL_ENTRY_FILE, type SkillFile } from "@t3tools/contracts";

/** Folders an import never carries into a skill: OS metadata and version control. */
const IGNORED_SEGMENTS = new Set(["__MACOSX", ".DS_Store", ".git", "node_modules"]);

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Files from a picked folder or zip, relative to the skill: the shallowest
 * directory holding a SKILL.md becomes the root, so a wrapping folder (as in
 * most zips and every folder pick) is stripped. Files outside that root and
 * OS or VCS noise are dropped.
 */
export function normalizeImportedFiles(entries: ReadonlyArray<SkillFile>): Array<SkillFile> {
  const kept = entries.filter(
    (entry) => !entry.path.split("/").some((segment) => IGNORED_SEGMENTS.has(segment)),
  );
  const entryPath = kept
    .map((entry) => entry.path)
    .filter((path) => path === SKILL_ENTRY_FILE || path.endsWith(`/${SKILL_ENTRY_FILE}`))
    .toSorted((left, right) => left.split("/").length - right.split("/").length)[0];
  const root = entryPath === undefined ? "" : entryPath.slice(0, -SKILL_ENTRY_FILE.length);
  return kept
    .filter((entry) => entry.path.startsWith(root))
    .map((entry) => ({ ...entry, path: entry.path.slice(root.length) }));
}

/** A valid skill name close to `raw`: lowercase words joined by dashes. */
export function toSkillName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63)
    .replace(/-$/, "");
  return SKILL_NAME_PATTERN.test(name) ? name : "imported-skill";
}

/** The `name:` a SKILL.md declares, else the folder or zip name it came from. */
export function importedSkillName(files: ReadonlyArray<SkillFile>, fallback: string): string {
  const entry = files.find((file) => file.path === SKILL_ENTRY_FILE);
  const frontmatter = entry ? FRONTMATTER_PATTERN.exec(entry.contents)?.[1] : undefined;
  const declared = frontmatter?.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
  return toSkillName(declared ?? fallback.replace(/\.zip$/i, ""));
}

/**
 * Point the frontmatter `name:` at the skill's folder name. Providers key a
 * skill by its folder, and a stale `name:` from a copy or rename would show a
 * different name in some skill lists.
 */
export function withFrontmatterName(contents: string, name: string): string {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) return `---\nname: ${name}\ndescription: \n---\n\n${contents}`;
  const body = match[1] ?? "";
  const nextBody = /^name:.*$/m.test(body)
    ? body.replace(/^name:.*$/m, `name: ${name}`)
    : `name: ${name}\n${body}`;
  return contents.replace(body, nextBody);
}

export function newSkillTemplate(name: string): string {
  return `---
name: ${name}
description: What this skill does, and when an agent should use it.
---

# ${name}

Steps the agent should follow. Put helper scripts in scripts/ and reference them here.
`;
}

/** Text a skill cannot carry: NUL bytes mean the file was binary. */
export function isBinaryText(contents: string): boolean {
  return contents.includes("\u0000");
}
