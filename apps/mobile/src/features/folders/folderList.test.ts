import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  type Folder,
  type FolderMember,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildFolderList, buildFolderThreads } from "./folderList";

const environmentId = EnvironmentId.make("environment-1");
const otherEnvironmentId = EnvironmentId.make("environment-2");

function makeMember(repoName: string, input: Partial<FolderMember> = {}): FolderMember {
  return {
    projectId: ProjectId.make(`project-${repoName}`),
    repoName,
    branch: "feat/login",
    baseBranch: "main",
    worktreePath: `/t3/folders/login/${repoName}`,
    archivedAt: null,
    ...input,
  };
}

function makeFolder(input: Partial<Folder> & Pick<Folder, "slug" | "name">): Folder {
  return {
    version: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    members: [],
    path: `/t3/folders/${input.slug}`,
    contextDir: `/t3/folders/${input.slug}/.context`,
    ...input,
  };
}

function makeThread(
  input: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id" | "projectId">,
): EnvironmentThreadShell {
  return {
    environmentId,
    title: input.id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    settledOverride: null,
    settledAt: null,
    ...input,
  };
}

const web = makeMember("web");
const api = makeMember("api");
const login = makeFolder({
  slug: "login",
  name: "Login",
  members: [web, api],
  rootProjectId: ProjectId.make("project-login-root"),
});

describe("buildFolderThreads", () => {
  it("matches member worktree threads and folder sessions, newest first", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("web-old"),
        projectId: web.projectId,
        worktreePath: web.worktreePath,
        updatedAt: "2026-06-02T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("session"),
        projectId: ProjectId.make("project-login-root"),
        updatedAt: "2026-06-04T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("api-new"),
        projectId: api.projectId,
        worktreePath: api.worktreePath,
        updatedAt: "2026-06-03T00:00:00.000Z",
      }),
      // The same project outside the folder's worktree is not a folder thread.
      makeThread({ id: ThreadId.make("web-main"), projectId: web.projectId }),
    ];

    const entries = buildFolderThreads({ environmentId, folder: login, threads });

    expect(entries.map((entry) => [entry.thread.id, entry.repoName])).toEqual([
      ["session", null],
      ["api-new", "api"],
      ["web-old", "web"],
    ]);
  });

  it("skips archived threads and threads from other environments", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("archived"),
        projectId: web.projectId,
        worktreePath: web.worktreePath,
        archivedAt: "2026-06-05T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("elsewhere"),
        environmentId: otherEnvironmentId,
        projectId: web.projectId,
        worktreePath: web.worktreePath,
      }),
    ];

    expect(buildFolderThreads({ environmentId, folder: login, threads })).toEqual([]);
  });
});

describe("buildFolderList", () => {
  const billing = makeFolder({
    slug: "billing",
    name: "Billing",
    createdAt: "2026-06-10T00:00:00.000Z",
    members: [makeMember("payments", { worktreePath: "/t3/folders/billing/payments" })],
  });
  const archived = makeFolder({
    slug: "old",
    name: "Old",
    archivedAt: "2026-06-11T00:00:00.000Z",
  });

  it("hides archived folders and orders by latest thread activity", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("web"),
        projectId: web.projectId,
        worktreePath: web.worktreePath,
        updatedAt: "2026-06-12T00:00:00.000Z",
      }),
    ];

    const entries = buildFolderList({
      environments: [{ environmentId, folders: [billing, login, archived] }],
      threads,
      searchQuery: "",
    });

    expect(entries.map((entry) => [entry.folder.slug, entry.threadCount])).toEqual([
      ["login", 1],
      ["billing", 0],
    ]);
  });

  it("searches folder names and repository names", () => {
    const environments = [{ environmentId, folders: [billing, login] }];

    expect(
      buildFolderList({ environments, threads: [], searchQuery: "PAY" }).map(
        (entry) => entry.folder.slug,
      ),
    ).toEqual(["billing"]);
    expect(
      buildFolderList({ environments, threads: [], searchQuery: "log" }).map(
        (entry) => entry.folder.slug,
      ),
    ).toEqual(["login"]);
  });
});
