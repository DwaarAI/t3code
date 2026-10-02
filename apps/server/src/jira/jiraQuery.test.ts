import { describe, expect, it } from "@effect/vitest";

import { normalizeSiteUrl, searchJql } from "./jiraQuery.ts";

describe("searchJql", () => {
  it("finds a ticket by key, passes JQL through, and full-text searches the rest", () => {
    expect(searchJql("dw-12")).toBe("key = DW-12");
    expect(searchJql('project = DW AND status = "In Progress"')).toBe(
      'project = DW AND status = "In Progress"',
    );
    expect(searchJql("key in (DW-1, DW-2)")).toBe("key in (DW-1, DW-2)");
    expect(searchJql("login is broken in safari")).toBe(
      'text ~ "login is broken in safari" ORDER BY updated DESC',
    );
    expect(searchJql('say "hi"')).toBe('text ~ "say \\"hi\\"" ORDER BY updated DESC');
  });
});

describe("normalizeSiteUrl", () => {
  it("keeps the https origin only", () => {
    expect(normalizeSiteUrl("https://acme.atlassian.net/jira/your-work")).toBe(
      "https://acme.atlassian.net",
    );
    expect(normalizeSiteUrl("http://acme.atlassian.net")).toBeNull();
    expect(normalizeSiteUrl("acme")).toBeNull();
  });
});
