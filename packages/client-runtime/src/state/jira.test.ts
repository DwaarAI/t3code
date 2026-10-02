import { describe, expect, it } from "@effect/vitest";
import type { JiraIssueSummary } from "@t3tools/contracts";

import { folderTicketsQuery, orderFolderTickets } from "./jira.ts";

const summary = (key: string) => ({ key }) as JiraIssueSummary;

describe("folder tickets", () => {
  it("queries attached keys and keeps the attachment order", () => {
    expect(folderTicketsQuery([])).toBeNull();
    expect(folderTicketsQuery(["DW-2", "DW-1"])).toBe("key in (DW-2, DW-1)");
    expect(
      orderFolderTickets(["DW-2", "DW-9", "DW-1"], [summary("DW-1"), summary("DW-2")]).map(
        (issue) => issue.key,
      ),
    ).toEqual(["DW-2", "DW-1"]);
  });
});
