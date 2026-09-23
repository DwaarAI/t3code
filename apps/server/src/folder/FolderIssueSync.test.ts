import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  type Folder,
  type FolderCreateInput,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as FolderGitHub from "./FolderGitHub.ts";
import * as FolderIssueSync from "./FolderIssueSync.ts";
import * as FolderService from "./FolderService.ts";

const project = (id: string, owner: string, name: string) =>
  ({
    id: ProjectId.make(id),
    repositoryIdentity: { provider: "github", owner, name },
  }) as unknown as OrchestrationProjectShell;

interface World {
  enabled: boolean;
  writers: Set<string>;
  issues: Record<string, FolderGitHub.LabeledIssue[]>;
  folders: Folder[];
  pullRequests: Record<string, string[]>;
  readonly created: FolderCreateInput[];
  readonly calls: string[];
}

const makeWorld = (overrides: Partial<World> = {}): World => ({
  enabled: true,
  writers: new Set(["maintainer"]),
  issues: {},
  folders: [],
  pullRequests: {},
  created: [],
  calls: [],
  ...overrides,
});

const issue = (number: number, author: string, body: string): FolderGitHub.LabeledIssue => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/acme/api/issues/${number}`,
  body,
  author,
});

const runSync = (world: World, passes = 1) =>
  Effect.gen(function* () {
    const syncOnce = yield* FolderIssueSync.makeSyncOnce;
    for (let pass = 0; pass < passes; pass += 1) yield* syncOnce;
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.sync(() => ({
            ...DEFAULT_SERVER_SETTINGS,
            githubIssueFolders: world.enabled,
          })),
        }),
        Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
          getShellSnapshot: () =>
            Effect.succeed({
              projects: [project("p-api", "acme", "api"), project("p-web", "acme", "web")],
              threads: [],
            } as unknown as OrchestrationShellSnapshot),
        }),
        Layer.mock(FolderService.FolderService)({
          list: () =>
            Effect.sync(() => ({ foldersDir: "/f", guidesDir: "/g", folders: world.folders })),
          create: (input) =>
            Effect.sync(() => {
              world.created.push(input);
              return {} as Folder;
            }),
          setIssueStatus: (input) =>
            Effect.sync(() => {
              world.calls.push(`status ${input.slug} ${input.status}`);
              return {} as Folder;
            }),
        }),
        Layer.mock(FolderGitHub.FolderGitHub)({
          listLabeledIssues: (repository) => Effect.sync(() => world.issues[repository] ?? []),
          canWrite: (repository, login) =>
            Effect.sync(() => {
              world.calls.push(`canWrite ${repository} ${login}`);
              return world.writers.has(login);
            }),
          defaultBranch: () => Effect.succeed("main"),
          ensureLabel: () => Effect.void,
          editLabels: (target, change) =>
            Effect.sync(() => {
              world.calls.push(
                `labels #${target.number} +${change.add.join(",")} -${change.remove.join(",")}`,
              );
            }),
          comment: (target, body) =>
            Effect.sync(() => {
              world.calls.push(`comment #${target.number} ${body}`);
            }),
          pullRequestStates: (repository, branch) =>
            Effect.sync(() => world.pullRequests[`${repository}@${branch}`] ?? []),
        }),
      ),
    ),
  );

describe("FolderIssueSync", () => {
  it.effect("does nothing while the setting is off", () =>
    Effect.gen(function* () {
      const world = makeWorld({
        enabled: false,
        issues: { "acme/api": [issue(1, "maintainer", "")] },
      });
      yield* runSync(world);
      expect(world.created).toEqual([]);
      expect(world.calls).toEqual([]);
    }),
  );

  it.effect("creates a folder from a labeled issue and its t3 block", () =>
    Effect.gen(function* () {
      const world = makeWorld({
        issues: {
          "acme/api": [
            issue(
              7,
              "maintainer",
              "```t3\nname: Checkout\nrepos: acme/api, acme/web\nbase: develop\nprompt: Plan it.\n```",
            ),
          ],
        },
      });
      yield* runSync(world);
      expect(world.created).toEqual([
        {
          name: "Checkout",
          members: [
            { projectId: "p-api", baseBranch: "develop" },
            { projectId: "p-web", baseBranch: "develop" },
          ],
          issue: "acme/api#7",
          initialPrompt: "Plan it.",
        },
      ]);
      expect(world.calls).toContain("labels #7 +t3:active -t3");
    }),
  );

  it.effect("ignores issues from authors who cannot push, without asking again", () =>
    Effect.gen(function* () {
      const world = makeWorld({ issues: { "acme/api": [issue(8, "stranger", "")] } });
      yield* runSync(world, 2);
      expect(world.created).toEqual([]);
      expect(world.calls.filter((call) => call.startsWith("canWrite"))).toHaveLength(1);
    }),
  );

  it.effect("reports repositories it cannot find on the issue", () =>
    Effect.gen(function* () {
      const world = makeWorld({
        issues: { "acme/api": [issue(9, "maintainer", "```t3\nrepos: acme/mobile\n```")] },
      });
      yield* runSync(world);
      expect(world.created).toEqual([]);
      expect(world.calls).toEqual(
        expect.arrayContaining([
          expect.stringContaining("comment #9 T3 Code could not create a folder"),
          "labels #9 +t3:error -t3",
        ]),
      );
    }),
  );

  it.effect("moves linked issues to review when a pull request opens", () =>
    Effect.gen(function* () {
      const world = makeWorld({
        folders: [
          {
            slug: "checkout",
            archivedAt: null,
            issue: {
              repository: "acme/api",
              number: 7,
              url: "u",
              title: "t",
              status: "in-progress",
            },
            members: [{ projectId: ProjectId.make("p-api"), branch: "feat/checkout" }],
          } as unknown as Folder,
        ],
        pullRequests: { "acme/api@feat/checkout": ["OPEN"] },
      });
      yield* runSync(world);
      expect(world.calls).toContain("status checkout in-review");
    }),
  );
});
