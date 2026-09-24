import { describe, expect, it } from "@effect/vitest";
import type { Folder } from "@t3tools/contracts";

import { findFolderForCwd, findFolderForThread } from "./folders.ts";

const folder = {
  slug: "checkout",
  path: "/t3/folders/checkout",
  rootProjectId: "p-root",
  members: [{ projectId: "p-api", worktreePath: "/t3/folders/checkout/api" }],
} as unknown as Folder;

describe("findFolderForThread", () => {
  it("matches repository threads by worktree and folder sessions by project", () => {
    expect(
      findFolderForThread([folder], {
        projectId: "p-api",
        worktreePath: "/t3/folders/checkout/api",
      })?.member?.projectId,
    ).toBe("p-api");
    expect(findFolderForThread([folder], { projectId: "p-root", worktreePath: null })).toEqual({
      folder,
      member: null,
    });
  });

  it("does not claim the folder project's threads that run in a worktree, or other projects", () => {
    expect(
      findFolderForThread([folder], { projectId: "p-root", worktreePath: "/elsewhere" }),
    ).toBeNull();
    expect(findFolderForThread([folder], { projectId: "p-api", worktreePath: null })).toBeNull();
  });
});

describe("findFolderForCwd", () => {
  it("resolves the folder directory and member worktrees", () => {
    expect(findFolderForCwd([folder], "/t3/folders/checkout")?.member).toBeNull();
    expect(findFolderForCwd([folder], "/t3/folders/checkout/api")?.member?.projectId).toBe("p-api");
    expect(findFolderForCwd([folder], "/repos/api")).toBeNull();
  });
});
