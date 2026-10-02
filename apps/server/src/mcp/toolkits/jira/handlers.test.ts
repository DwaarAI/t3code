import { describe, expect, it } from "@effect/vitest";

import { findTransition } from "./handlers.ts";

describe("findTransition", () => {
  const transitions = [
    { id: "21", name: "Start review", toStatus: "In Review" },
    { id: "31", name: "Done", toStatus: "Done" },
  ];

  it("matches the target status first, then the transition name, ignoring case", () => {
    expect(findTransition(transitions, "in review")?.id).toBe("21");
    expect(findTransition(transitions, "START REVIEW")?.id).toBe("21");
    expect(findTransition(transitions, " done ")?.id).toBe("31");
    expect(findTransition(transitions, "Blocked")).toBeNull();
  });
});
