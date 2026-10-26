import { describe, expect, it } from "vite-plus/test";
import { buildRuntimeInstructions } from "./runtimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("appends host instructions after the PR linking block", () => {
    const instructions = buildRuntimeInstructions({
      harness: "Codex",
      extraInstructions: "<t3_folder>notes</t3_folder>",
    });
    expect(instructions.endsWith("</pull_request_linking>\n\n<t3_folder>notes</t3_folder>")).toBe(
      true,
    );
    expect(buildRuntimeInstructions({ harness: "Codex", extraInstructions: null })).toMatch(
      /<\/pull_request_linking>$/,
    );
  });
});
