import { describe, expect, it } from "@effect/vitest";
import type { ServerProvider } from "@t3tools/contracts";

import { pickReviewModel } from "./useStartReview";

const provider = (overrides: Partial<ServerProvider>) =>
  ({
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    status: "ready",
    models: [
      { slug: "gpt-mini", name: "Mini", isCustom: false },
      { slug: "gpt-main", name: "Main", isCustom: false, isDefault: true },
    ],
    ...overrides,
  }) as unknown as ServerProvider;

describe("pickReviewModel", () => {
  it("uses a ready Codex instance and its default model", () => {
    expect(
      pickReviewModel([
        provider({ driver: "claudeAgent" as never, instanceId: "c" as never }),
        provider({}),
      ]),
    ).toEqual({ instanceId: "codex", model: "gpt-main" });
  });

  it("skips Codex instances that cannot take a turn", () => {
    expect(pickReviewModel([provider({ enabled: false })])).toBeNull();
    expect(pickReviewModel([provider({ installed: false })])).toBeNull();
    expect(pickReviewModel([provider({ status: "error" })])).toBeNull();
    expect(pickReviewModel([provider({ availability: "unavailable" as never })])).toBeNull();
    expect(pickReviewModel([])).toBeNull();
  });
});
