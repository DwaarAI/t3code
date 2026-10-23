import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderHostLive from "./ProviderHostLive.ts";

const layerTest = ProviderHostLive.layer.pipe(
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-provider-host-live-test-" }).pipe(
      Layer.provideMerge(NodeServices.layer),
    ),
  ),
);

describe("ProviderHostLive.sessionContext", () => {
  it.effect("grants a folder worktree its folder and notes, plus the guides", () =>
    Effect.gen(function* () {
      const host = yield* ProviderHost.ProviderHost;
      const { foldersDir, guidesDir } = yield* ServerConfig.ServerConfig;
      const path = yield* Path.Path;

      const context = host.sessionContext(path.join(foldersDir, "auth", "api"));

      expect(context.readableDirs).toEqual([guidesDir, path.join(foldersDir, "auth")]);
      expect(context.writableDirs).toEqual([path.join(foldersDir, "auth", ".context")]);
      expect(context.instructions).toContain('the "api" repository');
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("gives a plain cwd only the guides", () =>
    Effect.gen(function* () {
      const host = yield* ProviderHost.ProviderHost;
      const { guidesDir } = yield* ServerConfig.ServerConfig;

      for (const cwd of ["/repos/api", null]) {
        expect(host.sessionContext(cwd)).toEqual({
          instructions: null,
          readableDirs: [guidesDir],
          writableDirs: [],
        });
      }
    }).pipe(Effect.provide(layerTest)),
  );
});
