import { describe, expect, it } from "vite-plus/test";

import { extraRootPathEntries } from "./composerPathSearch.ts";

describe("extraRootPathEntries", () => {
  it("makes files absolute and labels them by root and folder", () => {
    expect(
      extraRootPathEntries({ cwd: "/folders/feature/.context/", label: ".context" }, [
        { path: "handoffs/2026-10-01.md", kind: "file" },
        { path: "notes.md", kind: "file" },
        { path: "plans", kind: "directory" },
      ]),
    ).toEqual([
      {
        path: "/folders/feature/.context/handoffs/2026-10-01.md",
        kind: "file",
        sourceLabel: ".context/handoffs",
      },
      { path: "/folders/feature/.context/notes.md", kind: "file", sourceLabel: ".context" },
    ]);
  });

  it("keeps Windows separators and lists only the first few files", () => {
    const entries = extraRootPathEntries(
      { cwd: "C:\\t3\\guides", label: "guides" },
      Array.from({ length: 8 }, (_, index) => ({
        path: `guide-${index}.md`,
        kind: "file" as const,
      })),
    );
    expect(entries).toHaveLength(5);
    expect(entries[0]?.path).toBe("C:\\t3\\guides\\guide-0.md");
  });
});
