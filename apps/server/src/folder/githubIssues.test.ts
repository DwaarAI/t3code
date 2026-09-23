import { describe, expect, it } from "@effect/vitest";

import {
  nextAutomaticStatus,
  parseIssueReference,
  parseT3Block,
  renderIssueContext,
} from "./githubIssues.ts";

describe("parseIssueReference", () => {
  it("accepts issue URLs and short references", () => {
    expect(parseIssueReference("https://github.com/acme/api/issues/42")).toEqual({
      repository: "acme/api",
      number: 42,
    });
    expect(parseIssueReference("https://github.com/acme/api/issues/42#issuecomment-1")).toEqual({
      repository: "acme/api",
      number: 42,
    });
    expect(parseIssueReference(" acme/web#7 ")).toEqual({ repository: "acme/web", number: 7 });
  });

  it("rejects anything else", () => {
    expect(parseIssueReference("https://github.com/acme/api/pull/42")).toBeNull();
    expect(parseIssueReference("acme#42")).toBeNull();
    expect(parseIssueReference("acme/api#0")).toBeNull();
    expect(parseIssueReference("https://gitlab.com/acme/api/issues/42")).toBeNull();
  });
});

describe("parseT3Block", () => {
  it("reads settings and a multi-line prompt", () => {
    const body = [
      "We need a checkout flow.",
      "",
      "```t3",
      "name: Checkout",
      "repos: acme/api, acme/web",
      "base: develop",
      "prompt: |",
      "  Plan the checkout flow first.",
      "    Keep the API backwards compatible.",
      "```",
      "",
      "More text.",
    ].join("\n");
    expect(parseT3Block(body)).toEqual({
      name: "Checkout",
      repos: ["acme/api", "acme/web"],
      base: "develop",
      prompt: "Plan the checkout flow first.\n  Keep the API backwards compatible.",
    });
  });

  it("reads list-style repositories and an inline prompt", () => {
    const body = "```t3\nrepos:\n  - acme/api\n  - acme/web\nbranch: feat/x\nprompt: Do it.\n```";
    expect(parseT3Block(body)).toEqual({
      repos: ["acme/api", "acme/web"],
      branch: "feat/x",
      prompt: "Do it.",
    });
  });

  it("handles CRLF bodies from github.com", () => {
    const body =
      "Intro\r\n```t3\r\nrepos: acme/api\r\nprompt: |\r\n  Line one.\r\n  Line two.\r\n```\r\n";
    expect(parseT3Block(body)).toEqual({ repos: ["acme/api"], prompt: "Line one.\nLine two." });
  });

  it("returns null without a block", () => {
    expect(parseT3Block("Just an issue.")).toBeNull();
    expect(parseT3Block(null)).toBeNull();
  });
});

describe("nextAutomaticStatus", () => {
  it("moves forward with pull request state", () => {
    expect(nextAutomaticStatus(null, [])).toBeNull();
    expect(nextAutomaticStatus("in-progress", ["OPEN"])).toBe("in-review");
    expect(nextAutomaticStatus("in-review", ["MERGED", "OPEN"])).toBeNull();
    expect(nextAutomaticStatus("in-review", ["MERGED", "CLOSED"])).toBe("done");
    expect(nextAutomaticStatus("in-progress", ["CLOSED"])).toBeNull();
  });

  it("never moves a status back", () => {
    expect(nextAutomaticStatus("done", ["OPEN"])).toBeNull();
  });
});

describe("renderIssueContext", () => {
  it("points agents at the issue and its parent", () => {
    const text = renderIssueContext({
      issue: { repository: "acme/api", number: 5, url: "https://x/5", title: "Phase 2" },
      parent: { repository: "acme/api", number: 1, url: "https://x/1", title: "Checkout" },
      body: "Build the API.",
    });
    expect(text).toContain("gh issue view 5 --repo acme/api --comments");
    expect(text).toContain("gh issue view 1 --repo acme/api");
    expect(text).toContain("Build the API.");
  });
});
