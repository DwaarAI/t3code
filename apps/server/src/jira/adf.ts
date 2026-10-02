/**
 * Jira Cloud stores rich text as Atlassian Document Format (ADF). Clients and
 * agents work in Markdown, so descriptions and comments are converted at the
 * server boundary. Reading covers the nodes Jira's editor produces; writing
 * covers headings, paragraphs, lists, quotes, rules, code blocks, and bold,
 * italic, strikethrough, code and link marks. Anything else reads as text.
 */

import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export interface AdfNode {
  readonly type: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly marks?: ReadonlyArray<{
    readonly type: string;
    readonly attrs?: Readonly<Record<string, unknown>>;
  }>;
  readonly content?: ReadonlyArray<AdfNode>;
}

const isNode = (value: unknown): value is AdfNode =>
  typeof value === "object" && value !== null && typeof (value as AdfNode).type === "string";

const attrString = (node: AdfNode, name: string): string | null => {
  const value = node.attrs?.[name];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
};

function inlineToMarkdown(nodes: ReadonlyArray<AdfNode> | undefined): string {
  return (nodes ?? []).map(inlineNodeToMarkdown).join("");
}

function inlineNodeToMarkdown(node: AdfNode): string {
  switch (node.type) {
    case "text": {
      let text = node.text ?? "";
      let href: string | null = null;
      for (const mark of node.marks ?? []) {
        switch (mark.type) {
          case "code":
            text = `\`${text}\``;
            break;
          case "strong":
            text = `**${text}**`;
            break;
          case "em":
            text = `*${text}*`;
            break;
          case "strike":
            text = `~~${text}~~`;
            break;
          case "link": {
            const value = mark.attrs?.href;
            href = typeof value === "string" ? value : null;
            break;
          }
        }
      }
      return href ? `[${text}](${href})` : text;
    }
    case "hardBreak":
      return "\n";
    case "mention":
      return attrString(node, "text") ?? "@someone";
    case "emoji":
      return attrString(node, "text") ?? attrString(node, "shortName") ?? "";
    case "inlineCard":
    case "blockCard":
      return attrString(node, "url") ?? "";
    case "date": {
      const date = DateTime.make(Number(attrString(node, "timestamp")));
      return Option.match(date, {
        onNone: () => "",
        onSome: (value) => DateTime.formatIso(value).slice(0, 10),
      });
    }
    case "status":
      return `[${attrString(node, "text") ?? ""}]`;
    default:
      return node.content ? inlineToMarkdown(node.content) : (node.text ?? "");
  }
}

const indent = (text: string, prefix: string) =>
  text
    .split("\n")
    .map((line, index) => (index === 0 || line === "" ? line : `${prefix}${line}`))
    .join("\n");

function listToMarkdown(node: AdfNode, ordered: boolean): string {
  const start = Number(attrString(node, "order") ?? 1);
  return (node.content ?? [])
    .map((item, index) => {
      const marker =
        node.type === "taskList"
          ? `- [${attrString(item, "state") === "DONE" ? "x" : " "}] `
          : ordered
            ? `${start + index}. `
            : "- ";
      const body =
        item.type === "taskItem"
          ? inlineToMarkdown(item.content)
          : blocksToMarkdown(item.content, "\n");
      return `${marker}${indent(body, " ".repeat(marker.length))}`;
    })
    .join("\n");
}

function tableToMarkdown(node: AdfNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      blocksToMarkdown(cell.content, " ").replaceAll("\n", " ").replaceAll("|", "\\|"),
    ),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: ReadonlyArray<string>) =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
  return [line(rows[0]!), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function blockToMarkdown(node: AdfNode): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(attrString(node, "level") ?? 1)));
      return `${"#".repeat(level)} ${inlineToMarkdown(node.content)}`;
    }
    case "bulletList":
    case "taskList":
      return listToMarkdown(node, false);
    case "orderedList":
      return listToMarkdown(node, true);
    case "codeBlock":
      return `\`\`\`${attrString(node, "language") ?? ""}\n${inlineToMarkdown(node.content)}\n\`\`\``;
    case "blockquote":
      return blocksToMarkdown(node.content, "\n\n")
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    case "rule":
      return "---";
    case "panel":
      return blocksToMarkdown(node.content, "\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "table":
      return tableToMarkdown(node);
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return "[attachment]";
    case "expand":
    case "nestedExpand": {
      const title = attrString(node, "title");
      const body = blocksToMarkdown(node.content, "\n\n");
      return title ? `**${title}**\n\n${body}` : body;
    }
    default:
      return node.content ? blocksToMarkdown(node.content, "\n\n") : inlineNodeToMarkdown(node);
  }
}

function blocksToMarkdown(nodes: ReadonlyArray<AdfNode> | undefined, separator: string): string {
  return (nodes ?? [])
    .map(blockToMarkdown)
    .filter((block) => block.length > 0)
    .join(separator);
}

/** Markdown for an ADF document; Jira Server's plain-text fields pass through. */
export function adfToMarkdown(document: unknown): string {
  if (typeof document === "string") return document;
  if (!isNode(document)) return "";
  return blocksToMarkdown(document.content, "\n\n").trim();
}

type Mark = { readonly type: string; readonly attrs?: Record<string, unknown> };

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/;

function textNode(text: string, marks: ReadonlyArray<Mark>): AdfNode {
  return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function inlineFromMarkdown(source: string, marks: ReadonlyArray<Mark> = []): AdfNode[] {
  const nodes: AdfNode[] = [];
  const lines = source.split("\n");
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) nodes.push({ type: "hardBreak" });
    let rest = line;
    while (rest.length > 0) {
      const match = INLINE_PATTERN.exec(rest);
      if (!match) {
        nodes.push(textNode(rest, marks));
        break;
      }
      if (match.index > 0) nodes.push(textNode(rest.slice(0, match.index), marks));
      const token = match[0];
      if (match[1]) {
        nodes.push(textNode(token.slice(1, -1), [...marks, { type: "code" }]));
      } else if (match[2]) {
        nodes.push(...inlineFromMarkdown(token.slice(2, -2), [...marks, { type: "strong" }]));
      } else if (match[3]) {
        nodes.push(...inlineFromMarkdown(token.slice(2, -2), [...marks, { type: "strike" }]));
      } else if (match[4]) {
        const split = token.lastIndexOf("](");
        nodes.push(
          ...inlineFromMarkdown(token.slice(1, split), [
            ...marks,
            { type: "link", attrs: { href: token.slice(split + 2, -1) } },
          ]),
        );
      } else {
        nodes.push(...inlineFromMarkdown(token.slice(1, -1), [...marks, { type: "em" }]));
      }
      rest = rest.slice(match.index + token.length);
    }
  });
  return nodes;
}

const paragraph = (text: string): AdfNode => ({
  type: "paragraph",
  content: inlineFromMarkdown(text),
});

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Parses list lines into nested ADF lists by indentation. */
function listFromLines(lines: ReadonlyArray<string>): AdfNode {
  const first = LIST_ITEM.exec(lines[0]!)!;
  const baseIndent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: AdfNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index]!)!;
    const text = [match[3]!];
    const nested: string[] = [];
    index += 1;
    while (index < lines.length) {
      const next = LIST_ITEM.exec(lines[index]!);
      if (next && next[1]!.length <= baseIndent) break;
      if (next) nested.push(lines[index]!);
      else if (nested.length === 0) text.push(lines[index]!.trim());
      else nested.push(lines[index]!);
      index += 1;
    }
    const content: AdfNode[] = [paragraph(text.join("\n"))];
    if (nested.length > 0) content.push(listFromLines(nested));
    items.push({ type: "listItem", content });
  }
  return ordered
    ? { type: "orderedList", attrs: { order: Number.parseInt(first[2]!, 10) }, content: items }
    : { type: "bulletList", content: items };
}

function blocksFromMarkdown(source: string): AdfNode[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: AdfNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]!.trim() !== "```") {
        body.push(lines[index]!);
        index += 1;
      }
      index += 1;
      const code = body.join("\n");
      blocks.push({
        type: "codeBlock",
        ...(fence[1] ? { attrs: { language: fence[1] } } : {}),
        ...(code.length > 0 ? { content: [{ type: "text", text: code }] } : {}),
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        attrs: { level: heading[1]!.length },
        content: inlineFromMarkdown(heading[2]!.trim()),
      });
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (index < lines.length && lines[index]!.startsWith(">")) {
        quoted.push(lines[index]!.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", content: blocksFromMarkdown(quoted.join("\n")) });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && lines[index]!.trim() !== "") {
        if (!LIST_ITEM.test(lines[index]!) && !/^\s/.test(lines[index]!) && listLines.length > 0) {
          break;
        }
        listLines.push(lines[index]!);
        index += 1;
      }
      blocks.push(listFromLines(listLines));
      continue;
    }
    const text: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !/^(#{1,6}\s|```|>)/.test(lines[index]!) &&
      !LIST_ITEM.test(lines[index]!)
    ) {
      text.push(lines[index]!);
      index += 1;
    }
    blocks.push(paragraph(text.join("\n")));
  }
  return blocks;
}

/** An ADF document for Markdown; empty text yields an empty document. */
export function markdownToAdf(markdown: string): AdfNode {
  return { type: "doc", version: 1, content: blocksFromMarkdown(markdown) } as AdfNode;
}
