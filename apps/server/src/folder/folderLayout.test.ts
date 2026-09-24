import { describe, expect, it } from "@effect/vitest";

import type { OrchestrationThread } from "@t3tools/contracts";

import {
  buildHandoffMarkdown,
  envFilesToCopy,
  planFileName,
  renderPlanFile,
  resolveFolderScope,
  resolveFolderSessionContext,
  slugifyFolderName,
} from "./folderLayout.ts";

describe("resolveFolderScope", () => {
  const foldersDir = "/home/me/.t3/folders";

  it("resolves a member worktree and any path inside it", () => {
    expect(resolveFolderScope("/home/me/.t3/folders/auth/api", foldersDir)).toEqual({
      slug: "auth",
      folderDir: "/home/me/.t3/folders/auth",
      contextDir: "/home/me/.t3/folders/auth/.context",
      repoName: "api",
    });
    expect(resolveFolderScope("/home/me/.t3/folders/auth/api/src", foldersDir)?.repoName).toBe(
      "api",
    );
  });

  it("resolves the folder directory itself as a folder session", () => {
    expect(resolveFolderScope("/home/me/.t3/folders/auth", foldersDir)).toEqual({
      slug: "auth",
      folderDir: "/home/me/.t3/folders/auth",
      contextDir: "/home/me/.t3/folders/auth/.context",
      repoName: null,
    });
  });

  it("ignores paths outside folders and the shared notes themselves", () => {
    expect(resolveFolderScope(undefined, foldersDir)).toBeNull();
    expect(resolveFolderScope("/home/me/.t3/folders", foldersDir)).toBeNull();
    expect(resolveFolderScope("/home/me/.t3/folders/auth/.context", foldersDir)).toBeNull();
    expect(resolveFolderScope("/home/me/.t3/folders-old/auth/api", foldersDir)).toBeNull();
    expect(resolveFolderScope("/repos/api", foldersDir)).toBeNull();
  });

  it("handles Windows paths", () => {
    expect(
      resolveFolderScope("C:\\Users\\me\\.t3\\folders\\auth\\api", "C:\\Users\\me\\.t3\\folders")
        ?.contextDir,
    ).toBe("C:\\Users\\me\\.t3\\folders\\auth\\.context");
  });

  it("lets repository sessions read the whole folder but write only the notes", () => {
    const context = resolveFolderSessionContext("/home/me/.t3/folders/auth/api", {
      foldersDir,
      guidesDir: "/home/me/.t3/guides",
    });
    expect(context?.accessDirs).toEqual(["/home/me/.t3/folders/auth"]);
    expect(context?.writableDirs).toEqual(["/home/me/.t3/folders/auth/.context"]);
    expect(context?.instructions).toContain('the "api" repository');
    expect(context?.instructions).toContain("/home/me/.t3/guides");
  });

  it("tells a folder session it spans every repository", () => {
    const context = resolveFolderSessionContext("/home/me/.t3/folders/auth", {
      foldersDir,
      guidesDir: "/home/me/.t3/guides",
    });
    // The cwd is the folder, so nothing outside it needs granting.
    expect(context?.accessDirs).toEqual([]);
    expect(context?.writableDirs).toEqual([]);
    expect(context?.instructions).toContain("folder-level session");
  });
});

describe("slugifyFolderName", () => {
  it("makes names safe for directories and branches", () => {
    expect(slugifyFolderName("  Auth Revamp: Phase 2!  ")).toBe("auth-revamp-phase-2");
    expect(slugifyFolderName("Café")).toBe("cafe");
    expect(slugifyFolderName("!!!")).toBe("");
  });
});

describe("buildHandoffMarkdown", () => {
  const message = (role: "user" | "assistant", text: string, streaming = false) =>
    ({ role, text, streaming }) as OrchestrationThread["messages"][number];

  const thread = (messages: OrchestrationThread["messages"]) =>
    ({
      id: "thread-1",
      title: "Implement search",
      branch: "feat/search",
      worktreePath: "/f/search/api",
      modelSelection: { instanceId: "claude", model: "opus" },
      proposedPlans: [],
      messages,
    }) as unknown as OrchestrationThread;

  it("pairs each request with the agent's final reply", () => {
    const note = buildHandoffMarkdown({
      thread: thread([
        message("user", "Add search"),
        message("assistant", "Looking into it"),
        message("assistant", "Search is done"),
        message("user", "Now add tests"),
        message("assistant", "partial", true),
      ]),
      folderName: "Search",
      member: null,
      writtenAt: "2026-09-22T10:00:00.000Z",
    });
    expect(note).toContain("### 1. Request\n\nAdd search\n\n### 1. Result\n\nSearch is done");
    expect(note).not.toContain("Looking into it");
    expect(note).toContain("### 2. Request\n\nNow add tests\n\n### 2. Result\n\n_No reply yet._");
  });

  it("keeps the first request and the latest exchanges when the digest is too long", () => {
    const long = "x".repeat(5_000);
    const messages = Array.from({ length: 40 }, (_, index) => [
      message("user", `request ${index}`),
      message("assistant", `${long} reply ${index}`),
    ]).flat();
    const note = buildHandoffMarkdown({
      thread: thread(messages),
      folderName: "Search",
      member: null,
      writtenAt: "2026-09-22T10:00:00.000Z",
    });
    expect(note).toContain("request 0\n");
    expect(note).toContain("request 39\n");
    expect(note).toMatch(/_\d+ earlier exchanges omitted\._/);
    expect(note.length).toBeLessThan(100_000);
  });
});

describe("envFilesToCopy", () => {
  it("keeps .env files and skips collapsed directories", () => {
    expect(
      envFilesToCopy([
        ".env",
        ".env.local",
        "apps/web/.env.production",
        ".envrc",
        "node_modules/",
        ".env-dir/",
        "notes.txt",
        "../.env",
        "",
      ]),
    ).toEqual([".env", ".env.local", "apps/web/.env.production", ".envrc"]);
  });
});

describe("plan files", () => {
  it("names one file per plan and records where it came from", () => {
    const fileName = planFileName({
      planId: "plan-7f3a9c21-0000",
      createdAt: "2026-09-24T08:15:00.000Z",
      threadTitle: "Checkout: API & web",
    });
    expect(fileName).toBe("2026-09-24-0815-checkout-api-web-plan7f3a.md");
    const text = renderPlanFile({
      planMarkdown: "# Plan\n\n1. Do it\n",
      threadTitle: "Checkout",
      repoName: null,
      fileName,
    });
    expect(text).toContain("the folder session");
    expect(text).toContain(`plans/${fileName}`);
    expect(text.endsWith("1. Do it\n")).toBe(true);
  });
});
