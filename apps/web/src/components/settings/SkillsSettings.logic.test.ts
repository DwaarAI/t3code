import { describe, expect, it } from "vite-plus/test";

import {
  importedSkillName,
  normalizeImportedFiles,
  toSkillName,
  withFrontmatterName,
} from "./SkillsSettings.logic";

const file = (path: string, contents = "") => ({ path, contents, executable: false });

describe("normalizeImportedFiles", () => {
  it("roots the skill at the shallowest SKILL.md and drops OS noise", () => {
    const files = normalizeImportedFiles([
      file("deploy/SKILL.md"),
      file("deploy/scripts/up.sh"),
      file("deploy/examples/nested/SKILL.md"),
      file("__MACOSX/deploy/._SKILL.md"),
      file("deploy/.DS_Store"),
      file("README-outside.md"),
    ]);
    expect(files.map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "scripts/up.sh",
      "examples/nested/SKILL.md",
    ]);
  });

  it("keeps paths as they are when SKILL.md is already at the top", () => {
    expect(normalizeImportedFiles([file("SKILL.md"), file("a/b.md")]).map((e) => e.path)).toEqual([
      "SKILL.md",
      "a/b.md",
    ]);
  });
});

describe("skill names", () => {
  it("prefers the declared name and falls back to the archive name", () => {
    expect(
      importedSkillName([file("SKILL.md", "---\nname: Local Deploy\n---\n")], "whatever.zip"),
    ).toBe("local-deploy");
    expect(importedSkillName([file("SKILL.md", "no frontmatter")], "My_Skill.zip")).toBe(
      "my-skill",
    );
    expect(toSkillName("***")).toBe("imported-skill");
  });

  it("rewrites or adds the frontmatter name", () => {
    expect(withFrontmatterName("---\nname: old\ndescription: d\n---\nbody", "new")).toBe(
      "---\nname: new\ndescription: d\n---\nbody",
    );
    expect(withFrontmatterName("---\ndescription: d\n---\nbody", "new")).toBe(
      "---\nname: new\ndescription: d\n---\nbody",
    );
  });
});
