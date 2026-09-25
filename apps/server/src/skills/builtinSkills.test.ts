import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  builtinSkillsPaths,
  renderBuiltinSkillsModule,
} from "../../scripts/generate-builtin-skills.ts";
import { installBuiltinSkills } from "./builtinSkills.ts";

it.layer(NodeServices.layer)("builtinSkills", (it) => {
  it.effect("the generated module matches apps/server/builtin-skills", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { sourceDir, modulePath } = yield* builtinSkillsPaths;
      assert.strictEqual(
        yield* fs.readFileString(modulePath),
        yield* renderBuiltinSkillsModule(sourceDir),
        "Run `node apps/server/scripts/generate-builtin-skills.ts` after editing a built-in skill.",
      );
    }),
  );

  it.effect("writes the t3 plugin and replaces only server-owned skills", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const skillsDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-builtin-skills-" });
      const dirs = { skillsDir, skillRootsDir: path.join(skillsDir, "skills") };

      yield* installBuiltinSkills(dirs, [
        { path: "old-skill/SKILL.md", executable: false, contents: "old" },
      ]);
      yield* fs.makeDirectory(path.join(dirs.skillRootsDir, "mine"));
      yield* fs.writeFileString(path.join(dirs.skillRootsDir, "mine", "SKILL.md"), "mine");

      yield* installBuiltinSkills(dirs, [
        { path: "deploy/SKILL.md", executable: false, contents: "deploy" },
        { path: "deploy/scripts/up.sh", executable: true, contents: "#!/bin/sh\n" },
      ]);

      const manifest = yield* fs.readFileString(
        path.join(skillsDir, ".claude-plugin", "plugin.json"),
      );
      assert.include(manifest, '"name": "t3"');
      assert.deepEqual((yield* fs.readDirectory(dirs.skillRootsDir)).toSorted(), [
        "deploy",
        "mine",
      ]);
      const script = yield* fs.stat(path.join(dirs.skillRootsDir, "deploy", "scripts", "up.sh"));
      assert.notStrictEqual(script.mode & 0o111, 0);
    }),
  );
});
