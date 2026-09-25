import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { installBuiltinSkills } from "./builtinSkills.ts";
import * as SkillService from "./SkillService.ts";

const TestLayer = SkillService.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-skill-service-" })),
  Layer.provideMerge(NodeServices.layer),
);

const skillMd = (description: string) => `---\ndescription: ${description}\n---\n\nDo it.\n`;

describe("SkillService", () => {
  it.layer(TestLayer)((it) => {
    it.effect("creates, edits, renames, disables, and deletes a custom skill", () =>
      Effect.gen(function* () {
        const skills = yield* SkillService.SkillService;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { skillRootsDir, skillsDir } = yield* ServerConfig.ServerConfig;

        const created = yield* skills.save({
          name: "deploy",
          files: [
            { path: "SKILL.md", contents: skillMd("Deploy the app."), executable: false },
            { path: "scripts/up.sh", contents: "#!/bin/sh\necho up\n", executable: false },
            { path: "notes.md", contents: "old", executable: false },
          ],
        });
        expect(created).toMatchObject({
          name: "deploy",
          commandName: "t3:deploy",
          description: "Deploy the app.",
          source: "custom",
          enabled: true,
        });
        expect(created.files.find((file) => file.path === "scripts/up.sh")?.executable).toBe(true);

        const renamed = yield* skills.save({
          name: "ship",
          previousName: "deploy",
          files: [{ path: "SKILL.md", contents: skillMd("Ship it."), executable: false }],
        });
        expect(renamed.files.map((file) => file.path)).toEqual(["SKILL.md"]);
        expect(yield* fs.exists(path.join(skillRootsDir, "deploy"))).toBe(false);

        const disabled = yield* skills.setEnabled({ name: "ship", enabled: false });
        expect(disabled.enabled).toBe(false);
        expect(yield* fs.exists(path.join(skillsDir, "disabled", "ship", "SKILL.md"))).toBe(true);
        expect((yield* skills.get({ name: "ship" })).files[0]?.contents).toBe(skillMd("Ship it."));

        // Saving a disabled skill keeps it disabled.
        const edited = yield* skills.save({
          name: "ship",
          previousName: "ship",
          files: [{ path: "SKILL.md", contents: skillMd("Ship it now."), executable: false }],
        });
        expect(edited).toMatchObject({ enabled: false, description: "Ship it now." });

        yield* skills.delete({ name: "ship" });
        expect((yield* skills.list()).skills.map((skill) => skill.name)).not.toContain("ship");
      }),
    );

    it.effect("rejects unsafe files, duplicate names, and built-in names", () =>
      Effect.gen(function* () {
        const skills = yield* SkillService.SkillService;
        const entry = { path: "SKILL.md", contents: skillMd("x"), executable: false };

        const reasons = yield* Effect.all(
          [
            skills.save({ name: "a", files: [] }),
            skills.save({
              name: "b",
              files: [entry, { path: "../escape.sh", contents: "", executable: true }],
            }),
            skills.save({
              name: "c",
              files: [entry, { path: "/abs.md", contents: "", executable: false }],
            }),
            skills.save({ name: "dwaar-code-reviewer", files: [entry] }),
          ].map((effect) =>
            effect.pipe(
              Effect.flip,
              Effect.map((error) => error.reason),
            ),
          ),
        );
        expect(reasons).toEqual([
          "invalid_input",
          "invalid_input",
          "invalid_input",
          "already_exists",
        ]);

        yield* skills.save({ name: "twin", files: [entry] });
        const duplicate = yield* skills.save({ name: "twin", files: [entry] }).pipe(Effect.flip);
        expect(duplicate.reason).toBe("already_exists");
      }),
    );

    it.effect("lists built-in skills but refuses to change them", () =>
      Effect.gen(function* () {
        const skills = yield* SkillService.SkillService;
        yield* installBuiltinSkills(yield* ServerConfig.ServerConfig);

        const listed = (yield* skills.list()).skills.find(
          (skill) => skill.name === "dwaar-code-reviewer",
        );
        expect(listed).toMatchObject({ source: "builtin", enabled: true });
        expect(listed?.files.map((file) => file.path)).toEqual(["SKILL.md"]);

        const refused = yield* skills
          .setEnabled({ name: "dwaar-code-reviewer", enabled: false })
          .pipe(Effect.flip);
        expect(refused.reason).toBe("builtin");
      }),
    );
  });
});
