import { EnvironmentId, type Folder } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  folderThreadGroupKey,
  folderThreadKeys,
  groupFolderThreads,
  isFolderThreadKey,
} from "./SidebarFolders.logic";

const ENV = EnvironmentId.make("env-1");
const OTHER_ENV = EnvironmentId.make("env-2");

function thread(
  id: string,
  overrides: Partial<{
    environmentId: EnvironmentId;
    projectId: string;
    worktreePath: string | null;
    archivedAt: string | null;
    updatedAt: string;
  }> = {},
) {
  return {
    id,
    environmentId: ENV,
    projectId: "project-1",
    worktreePath: "/folders/feature/api",
    archivedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("folderThreadGroupKey", () => {
  it("keys worktree threads by path and folder sessions by project", () => {
    expect(folderThreadGroupKey(thread("a"))).toBe(
      folderThreadGroupKey(thread("b", { projectId: "project-2" })),
    );
    expect(folderThreadGroupKey(thread("a"))).not.toBe(
      folderThreadGroupKey(thread("b", { environmentId: OTHER_ENV })),
    );
    const session = folderThreadGroupKey(thread("a", { worktreePath: null }));
    expect(session).not.toBe(folderThreadGroupKey(thread("b")));
    expect(session).toBe(folderThreadGroupKey(thread("c", { worktreePath: null })));
    expect(session).not.toBe(
      folderThreadGroupKey(thread("d", { worktreePath: null, projectId: "project-2" })),
    );
  });
});

describe("groupFolderThreads", () => {
  it("drops archived threads and lists the latest activity first", () => {
    const grouped = groupFolderThreads([
      thread("old", { updatedAt: "2026-10-01T00:00:00.000Z" }),
      thread("archived", { archivedAt: "2026-10-02T00:00:00.000Z" }),
      thread("new", { updatedAt: "2026-10-03T00:00:00.000Z" }),
      thread("session", { worktreePath: null }),
    ]);
    expect(grouped.get(folderThreadGroupKey(thread("x")))?.map((entry) => entry.id)).toEqual([
      "new",
      "old",
    ]);
    expect(
      grouped
        .get(folderThreadGroupKey(thread("x", { worktreePath: null })))
        ?.map((entry) => entry.id),
    ).toEqual(["session"]);
  });
});

describe("folderThreadKeys", () => {
  const folder = {
    rootProjectId: "folder-project",
    members: [{ projectId: "project-1", worktreePath: "/folders/feature/api" }],
  } as unknown as Folder;

  it("matches member worktree threads and folder session threads only", () => {
    const keys = folderThreadKeys([{ environmentId: ENV, folders: [folder] }]);
    expect(isFolderThreadKey(keys, thread("worktree"))).toBe(true);
    expect(
      isFolderThreadKey(
        keys,
        thread("session", { projectId: "folder-project", worktreePath: null }),
      ),
    ).toBe(true);
    expect(isFolderThreadKey(keys, thread("local", { worktreePath: null }))).toBe(false);
    expect(isFolderThreadKey(keys, thread("other-env", { environmentId: OTHER_ENV }))).toBe(false);
    expect(
      isFolderThreadKey(keys, thread("other-worktree", { worktreePath: "/repos/api-feature" })),
    ).toBe(false);
  });
});
