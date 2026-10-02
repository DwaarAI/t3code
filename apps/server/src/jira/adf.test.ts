import { describe, expect, it } from "@effect/vitest";

import { adfToMarkdown, markdownToAdf } from "./adf.ts";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

describe("adfToMarkdown", () => {
  it("renders Jira's common block and inline nodes", () => {
    const markdown = adfToMarkdown(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Goal")] },
        {
          type: "paragraph",
          content: [
            text("Ship "),
            text("checkout", [{ type: "strong" }]),
            text(" via "),
            text("docs", [{ type: "link", attrs: { href: "https://x.dev" } }]),
            { type: "hardBreak" },
            { type: "mention", attrs: { text: "@Ana" } },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("one")] }] },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [text("two")] },
                {
                  type: "orderedList",
                  content: [
                    { type: "listItem", content: [{ type: "paragraph", content: [text("a")] }] },
                  ],
                },
              ],
            },
          ],
        },
        { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;")] },
        { type: "mediaSingle", content: [{ type: "media", attrs: { id: "x" } }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [text("A")] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [text("B")] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [text("1")] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [text("2")] }] },
              ],
            },
          ],
        },
      ),
    );
    expect(markdown).toBe(
      [
        "## Goal",
        "",
        "Ship **checkout** via [docs](https://x.dev)\n@Ana",
        "",
        "- one\n- two\n  1. a",
        "",
        "```ts\nconst a = 1;\n```",
        "",
        "[attachment]",
        "",
        "| A | B |\n| --- | --- |\n| 1 | 2 |",
      ].join("\n"),
    );
  });

  it("passes plain text through and tolerates junk", () => {
    expect(adfToMarkdown("plain")).toBe("plain");
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown({ nope: true })).toBe("");
  });
});

describe("markdownToAdf", () => {
  it("round-trips the Markdown the UI and agents write", () => {
    const markdown = [
      "# Plan",
      "",
      "Use **bold**, *em*, `code` and [a link](https://x.dev).",
      "Second line.",
      "",
      "- first",
      "- second",
      "  - nested",
      "",
      "1. step",
      "2. step",
      "",
      "> quoted",
      "",
      "```sh",
      "echo hi",
      "```",
      "",
      "---",
    ].join("\n");
    expect(adfToMarkdown(markdownToAdf(markdown))).toBe(markdown);
  });

  it("produces the ADF nodes Jira expects", () => {
    expect(markdownToAdf("Hi **there**")).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi " },
            { type: "text", text: "there", marks: [{ type: "strong" }] },
          ],
        },
      ],
    });
    expect(markdownToAdf("")).toEqual({ type: "doc", version: 1, content: [] });
  });
});
