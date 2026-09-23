/**
 * Pure rules for linking folders to GitHub issues: parsing references and the
 * optional ```t3 block, status labels and their order, and the issue snapshot
 * written to `.context/issue.md`. FolderGitHub does the `gh` calls.
 */
import type { FolderIssueRef, FolderIssueStatus } from "@t3tools/contracts";

export interface IssueKey {
  /** `owner/name`. */
  readonly repository: string;
  readonly number: number;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Accepts `https://github.com/o/n/issues/12` or `o/n#12`. */
export function parseIssueReference(input: string): IssueKey | null {
  const trimmed = input.trim();
  const url = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)(?:[/?#].*)?$/i.exec(
    trimmed,
  );
  const short = /^([^/\s#]+\/[^/\s#]+)#(\d+)$/.exec(trimmed);
  const match = url ?? short;
  if (!match?.[1] || !match[2] || !REPOSITORY.test(match[1])) return null;
  const number = Number(match[2]);
  return number > 0 ? { repository: match[1], number } : null;
}

export function issueKeyOf(issue: IssueKey): string {
  return `${issue.repository.toLowerCase()}#${issue.number}`;
}

/** Settings written in an issue body to shape its folder. Every field is optional. */
export interface T3IssueBlock {
  readonly name?: string;
  readonly branch?: string;
  readonly base?: string;
  /** `owner/name` repositories; defaults to the issue's own repository. */
  readonly repos?: ReadonlyArray<string>;
  readonly prompt?: string;
}

/**
 * Reads the first fenced ```t3 block: `key: value` lines, where `repos` takes a
 * comma-separated or `- item` list and `prompt:` takes every line after it.
 */
export function parseT3Block(body: string | null | undefined): T3IssueBlock | null {
  // Issue bodies edited on github.com use CRLF line endings.
  const fence = /```t3[^\n]*\n([\s\S]*?)```/.exec((body ?? "").replaceAll("\r\n", "\n"));
  if (!fence?.[1]) return null;
  const lines = fence[1].split("\n");
  const block: { -readonly [K in keyof T3IssueBlock]: T3IssueBlock[K] } = {};
  let repos: string[] | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const listItem = /^\s*-\s+(\S+)\s*$/.exec(line);
    if (listItem?.[1] && repos !== null) {
      repos.push(listItem[1]);
      continue;
    }
    const entry = /^\s*([a-z]+)\s*:\s*(.*)$/i.exec(line);
    if (!entry?.[1]) continue;
    const key = entry[1].toLowerCase();
    const value = entry[2]?.trim() ?? "";
    repos = null;
    if (key === "prompt") {
      const rest = [value.replace(/^\|\s*$/, ""), ...lines.slice(index + 1)]
        .join("\n")
        .replace(/^\n+/, "");
      const indent = Math.min(
        ...rest
          .split("\n")
          .filter((candidate) => candidate.trim().length > 0)
          .map((candidate) => /^\s*/.exec(candidate)![0].length),
      );
      const prompt = rest
        .split("\n")
        .map((candidate) => candidate.slice(Number.isFinite(indent) ? indent : 0))
        .join("\n")
        .trim();
      if (prompt) block.prompt = prompt;
      break;
    }
    if (key === "repos") {
      repos = value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      block.repos = repos;
    } else if (key === "name" && value) block.name = value;
    else if (key === "branch" && value) block.branch = value;
    else if (key === "base" && value) block.base = value;
  }
  return block;
}

export const STATUS_LABELS: Record<FolderIssueStatus, string> = {
  "in-progress": "status:in-progress",
  "in-review": "status:in-review",
  done: "status:done",
};

export const STATUS_LABEL_COLORS: Record<FolderIssueStatus, string> = {
  "in-progress": "fbca04",
  "in-review": "0e8a16",
  done: "5319e7",
};

const STATUS_ORDER: ReadonlyArray<FolderIssueStatus> = ["in-progress", "in-review", "done"];

/**
 * The status a folder's pull requests imply, only when it moves the issue
 * forward. A person can always set any status by hand; automation never
 * moves it back.
 */
export function nextAutomaticStatus(
  current: FolderIssueStatus | null,
  pullRequestStates: ReadonlyArray<string>,
): FolderIssueStatus | null {
  const states = new Set(pullRequestStates.map((state) => state.toUpperCase()));
  const implied: FolderIssueStatus | null = states.has("OPEN")
    ? "in-review"
    : states.has("MERGED")
      ? "done"
      : null;
  if (implied === null) return null;
  const rank = (status: FolderIssueStatus | null) =>
    status === null ? -1 : STATUS_ORDER.indexOf(status);
  return rank(implied) > rank(current) ? implied : null;
}

/** The `.context/issue.md` snapshot, so agents can start without network access. */
export function renderIssueContext(input: {
  readonly issue: FolderIssueRef;
  readonly parent: FolderIssueRef | undefined;
  readonly body: string;
}): string {
  const { issue, parent } = input;
  const [owner, name] = issue.repository.split("/");
  return [
    `# ${issue.title}`,
    "",
    `GitHub issue ${issue.repository}#${issue.number}: ${issue.url}`,
    ...(parent
      ? [`Parent issue ${parent.repository}#${parent.number}: ${parent.title} (${parent.url})`]
      : []),
    "",
    "This is a snapshot from when the folder was created. For the latest discussion run",
    `\`gh issue view ${issue.number} --repo ${owner}/${name} --comments\`.`,
    ...(parent
      ? [
          `Read the parent issue for the wider goal: \`gh issue view ${parent.number} --repo ${parent.repository}\`.`,
        ]
      : []),
    `Post progress with \`gh issue comment ${issue.number} --repo ${issue.repository}\`.`,
    "",
    "## Issue body",
    "",
    input.body.trim() || "_No description._",
    "",
  ].join("\n");
}
