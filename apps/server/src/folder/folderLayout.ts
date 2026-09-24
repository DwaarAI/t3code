/**
 * Pure layout rules for feature folders: where things live on disk, what a new
 * `.context/` contains, what agents are told about it, and how a handoff note
 * is rendered from a thread. FolderService does the IO.
 */
import type { FolderMember, OrchestrationThread } from "@t3tools/contracts";
import type * as Path from "effect/Path";

export const FOLDER_MANIFEST_FILE = "folder.json";
export const FOLDER_CONTEXT_DIR = ".context";
export const FOLDER_CONTEXT_SUBDIRS = ["handoffs", "reviews", "plans"] as const;

export function slugifyFolderName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

export interface FolderScope {
  readonly slug: string;
  readonly folderDir: string;
  readonly contextDir: string;
  /** The member worktree the cwd is in, or null for a folder session at the folder root. */
  readonly repoName: string | null;
}

/**
 * A cwd belongs to a folder when it is the folder directory itself (a folder
 * session that spans every repository) or sits inside one of its member
 * worktrees, `<foldersDir>/<slug>/<repo>`. String math on server-produced
 * absolute paths, so provider adapters can call it on every session start
 * without extra services.
 */
export function resolveFolderScope(
  cwd: string | undefined,
  foldersDir: string,
): FolderScope | null {
  if (!cwd) return null;
  const sep = foldersDir.includes("\\") && !foldersDir.includes("/") ? "\\" : "/";
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  const root = normalize(foldersDir);
  const target = normalize(cwd);
  if (!target.startsWith(`${root}/`)) return null;
  const [slug, repoName] = target.slice(root.length + 1).split("/");
  if (!slug || slug === ".." || repoName === ".." || repoName === FOLDER_CONTEXT_DIR) return null;
  const folderDir = `${foldersDir.replace(/[\\/]+$/, "")}${sep}${slug}`;
  return {
    slug,
    folderDir,
    contextDir: `${folderDir}${sep}${FOLDER_CONTEXT_DIR}`,
    repoName: repoName ?? null,
  };
}

export interface FolderSessionContext {
  /** Appended to the provider's system or developer instructions. */
  readonly instructions: string;
  /**
   * Directories outside the cwd a session may open, for providers that gate
   * every access by directory (Claude, Antigravity): the whole folder, so a
   * repository session can read its sibling repositories while planning.
   */
  readonly accessDirs: ReadonlyArray<string>;
  /**
   * Directories outside the cwd a sandbox must let the agent write, for
   * providers that already read anywhere (Codex): only the shared notes.
   */
  readonly writableDirs: ReadonlyArray<string>;
}

/** What a provider session in `cwd` should know and be granted, or null outside folders. */
export function resolveFolderSessionContext(
  cwd: string | undefined,
  config: { readonly foldersDir: string; readonly guidesDir: string },
): FolderSessionContext | null {
  const scope = resolveFolderScope(cwd, config.foldersDir);
  if (scope === null) return null;
  const instructions = buildFolderInstructions({ scope, guidesDir: config.guidesDir });
  // A folder session's cwd is the folder itself, which already covers everything.
  if (scope.repoName === null) return { instructions, accessDirs: [], writableDirs: [] };
  return { instructions, accessDirs: [scope.folderDir], writableDirs: [scope.contextDir] };
}

/** Pick a worktree directory name that no other member of the folder uses. */
export function uniqueRepoName(
  path: Path.Path,
  workspaceRoot: string,
  taken: ReadonlyArray<string>,
): string {
  const base =
    path
      .basename(workspaceRoot)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+/, "") || "repo";
  const candidate = base === FOLDER_CONTEXT_DIR ? "repo" : base;
  if (!taken.includes(candidate)) return candidate;
  for (let index = 2; ; index += 1) {
    const next = `${candidate}-${index}`;
    if (!taken.includes(next)) return next;
  }
}

/**
 * Env files a new worktree lacks: untracked or ignored files named `.env*` in
 * the project's checkout. `entries` are `git ls-files --others` paths; a
 * collapsed directory arrives as one `dir/` entry and nothing inside it is
 * copied, which keeps dependency directories such as node_modules out.
 */
export function envFilesToCopy(entries: ReadonlyArray<string>): string[] {
  return entries.filter((entry) => {
    if (entry.length === 0 || entry.endsWith("/")) return false;
    if (entry.split("/").includes("..")) return false;
    const name = entry.slice(entry.lastIndexOf("/") + 1);
    return name.startsWith(".env");
  });
}

export function folderContextScaffold(input: {
  readonly name: string;
  readonly guidesDir: string;
}): Record<string, string> {
  return {
    "README.md": `# ${input.name}: shared context

Every thread working on "${input.name}" shares this directory, across all of the
folder's repositories. It lives outside the repositories, so nothing here is committed.

| Path | Use |
| --- | --- |
| \`plan.md\` | The current plan. Rewrite it when the plan changes. |
| \`todos.md\` | Open and finished tasks as a checklist. |
| \`handoffs/\` | Notes written when work moves to a new thread. |
| \`reviews/\` | Review findings, one file per review. |

The folder's repositories and branches are listed in \`../${FOLDER_MANIFEST_FILE}\`.
Reusable guidelines, such as review checklists, are in \`${input.guidesDir}\`.
`,
    "plan.md": `# Plan\n\nNot written yet.\n`,
    "todos.md": `# Todos\n\n- [ ] Write the plan in plan.md\n`,
  };
}

export const REVIEW_GUIDE_FILE = "review.md";

/** Guides seeded into the guides directory when missing; edited copies are kept. */
export const SEED_GUIDES: Record<string, string> = {
  [REVIEW_GUIDE_FILE]: `# Review guidelines:

You are acting as a reviewer for a proposed code change made by another engineer.

Below are some default guidelines for determining whether the original author would appreciate the issue being flagged.

These are not the final word in determining whether an issue is a bug. In many cases, you will encounter other, more specific guidelines. These may be present elsewhere in a developer message, a user message, a file, or even elsewhere in this system message.
Those guidelines should be considered to override these general instructions.

Here are the general guidelines for determining whether something is a bug and should be flagged.

1. It meaningfully impacts the accuracy, performance, security, or maintainability of the code.
2. The bug is discrete and actionable (i.e. not a general issue with the codebase or a combination of multiple issues).
3. Fixing the bug does not demand a level of rigor that is not present in the rest of the codebase (e.g. one doesn't need very detailed comments and input validation in a repository of one-off scripts in personal projects)
4. The bug was introduced in the commit (pre-existing bugs should not be flagged).
5. The author of the original PR would likely fix the issue if they were made aware of it.
6. The bug does not rely on unstated assumptions about the codebase or author's intent.
7. It is not enough to speculate that a change may disrupt another part of the codebase, to be considered a bug, one must identify the other parts of the code that are provably affected.
8. The bug is clearly not just an intentional change by the original author.

When flagging a bug, you will also provide an accompanying comment. Once again, these guidelines are not the final word on how to construct a comment -- defer to any subsequent guidelines that you encounter.

1. The comment should be clear about why the issue is a bug.
2. The comment should appropriately communicate the severity of the issue. It should not claim that an issue is more severe than it actually is.
3. The comment should be brief. The body should be at most 1 paragraph. It should not introduce line breaks within the natural language flow unless it is necessary for the code fragment.
4. The comment should not include any chunks of code longer than 3 lines. Any code chunks should be wrapped in markdown inline code tags or a code block.
5. The comment should clearly and explicitly communicate the scenarios, environments, or inputs that are necessary for the bug to arise. The comment should immediately indicate that the issue's severity depends on these factors.
6. The comment's tone should be matter-of-fact and not accusatory or overly positive. It should read as a helpful AI assistant suggestion without sounding too much like a human reviewer.
7. The comment should be written such that the original author can immediately grasp the idea without close reading.
8. The comment should avoid excessive flattery and comments that are not helpful to the original author. The comment should avoid phrasing like "Great job ...", "Thanks for ...".

Below are some more detailed guidelines that you should apply to this specific review.

HOW MANY FINDINGS TO RETURN:

Output all findings that the original author would fix if they knew about it. If there is no finding that a person would definitely love to see and fix, prefer outputting no findings. Do not stop at the first qualifying finding. Continue until you've listed every qualifying finding.

GUIDELINES:

- Ignore trivial style unless it obscures meaning or violates documented standards.
- Use one comment per distinct issue (or a multi-line range if necessary).
- Use \`\`\`suggestion blocks ONLY for concrete replacement code (minimal lines; no commentary inside the block).
- In every \`\`\`suggestion block, preserve the exact leading whitespace of the replaced lines (spaces vs tabs, number of spaces).
- Do NOT introduce or remove outer indentation levels unless that is the actual fix.

The comments will be presented in the code review as inline comments. You should avoid providing unnecessary location details in the comment body. Always keep the line range as short as possible for interpreting the issue. Avoid ranges longer than 5–10 lines; instead, choose the most suitable subrange that pinpoints the problem.

## Getting the diff

Review the branch against its base: the base named in the request (for example \`origin/main\`), or the repository's default branch. Run these in the repository's directory; in a T3 Code folder session, run them in each repository directory that changed.

\`\`\`bash
BASE=origin/main   # the base named in the request, when there is one
git fetch origin --quiet

# Get the merge base between this branch and the target
MERGE_BASE=$(git merge-base "$BASE" HEAD)

# Files that changed, then the committed diff against the merge base
git diff --stat "$MERGE_BASE" HEAD
git diff "$MERGE_BASE" HEAD

# Any uncommitted changes (staged and unstaged), and new untracked files
git diff HEAD
git status --short
\`\`\`

Review the combination of these outputs: the committed changes on this branch relative to the target, plus any uncommitted work in progress.

To find the branch's pull request, use the \`list_thread_pull_requests\` tool from the \`t3-code\` MCP server when it is available; otherwise run \`gh pr view --json number,url,baseRefName\`. \`gh pr diff <number>\` shows the pull request's diff, and \`gh api repos/{owner}/{repo}/pulls/{number}/comments\` lists the review comments already on it. Read those comments when the user asks you to address them.

## Output format

Write out a list of issues found, along with the location of each. **Only list ONE entry per unique issue.** For example:

<example>
### **#1 Empty input causes crash**

If the input field is empty when page loads, the app will crash.

File: src/client/frontends/desktop/ui/Input.tsx:42

### **#2 Dead code**

The getUserData function is now unused. It should be deleted.

File: src/client/frontends/desktop/core/UserData.ts:10-18
</example>

When the repository belongs to a T3 Code folder (it has a \`.context\` directory beside it or linked in it), also save the list to \`.context/reviews/<date>-<repository>.md\`.

Post the findings to the pull request only when the user asks. Then post each finding once, as an inline comment on the lines it names:

\`\`\`bash
gh api repos/{owner}/{repo}/pulls/{number}/comments \\
  -f body='<comment>' -f commit_id="$(git rev-parse HEAD)" \\
  -f path='<file>' -F line=<last line> -f side=RIGHT
\`\`\`

For a multi-line range, add \`-F start_line=<first line> -f start_side=RIGHT\`.
`,
};

/** Runtime instructions telling an agent about the folder its cwd belongs to. */
function buildFolderInstructions(input: {
  readonly scope: FolderScope;
  readonly guidesDir: string;
}): string {
  const { scope } = input;
  const notes = `Shared notes for the whole feature live in ${scope.contextDir}. Read README.md, plan.md, todos.md, and the newest file in handoffs/ before starting. Keep plan.md and todos.md current as work progresses, and write review findings to reviews/. Plans you propose in plan mode are saved to plans/ there and become plan.md automatically. Never commit these notes to a repository.
When ${scope.contextDir}/issue.md exists, the folder works on that GitHub issue: read it and its parent issue, and post progress on the issue with gh as milestones land.
Reusable guidelines, such as review checklists, are in ${input.guidesDir}.`;
  if (scope.repoName === null) {
    return `<t3_folder>
This is the folder-level session for the T3 Code folder "${scope.slug}", which spans several repositories. Your working directory is the folder: every subdirectory except .context is a git worktree of one repository, and ${FOLDER_MANIFEST_FILE} lists them with their branches. There is no repository at this level, so run git inside a repository's directory.
Plan and coordinate work across the repositories: say which repository each change belongs in, keep interfaces between them consistent, and commit in each repository separately.
${notes}
</t3_folder>`;
  }
  return `<t3_folder>
This thread works in the "${scope.repoName}" repository of the T3 Code folder "${scope.slug}". A folder groups the worktrees of one feature across repositories; ${FOLDER_MANIFEST_FILE} in ${scope.folderDir} lists them with their branches. The other repositories are sibling directories of this one: read them when the work crosses repositories, but change only this repository unless asked.
${notes} The notes are also reachable as .context in this repository, a link git ignores.
</t3_folder>`;
}

const MAX_USER_CHARS = 4_000;
const MAX_AGENT_CHARS = 6_000;
const MAX_DIGEST_CHARS = 80_000;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n\n[truncated]`;
}

interface Exchange {
  readonly user: string;
  readonly agent: string | null;
}

/** Pair each user message with the last agent reply before the next user message. */
function collectExchanges(messages: OrchestrationThread["messages"]): Exchange[] {
  const exchanges: Array<{ user: string; agent: string | null }> = [];
  for (const message of messages) {
    if (message.streaming || message.text.trim().length === 0) continue;
    if (message.role === "user") {
      exchanges.push({ user: message.text, agent: null });
    } else if (message.role === "assistant" && exchanges.length > 0) {
      exchanges[exchanges.length - 1]!.agent = message.text;
    }
  }
  return exchanges;
}

function renderExchange(exchange: Exchange, index: number): string {
  const agent =
    exchange.agent === null ? "_No reply yet._" : truncate(exchange.agent, MAX_AGENT_CHARS);
  return `### ${index + 1}. Request\n\n${truncate(exchange.user, MAX_USER_CHARS)}\n\n### ${index + 1}. Result\n\n${agent}`;
}

export function buildHandoffMarkdown(input: {
  readonly thread: Pick<
    OrchestrationThread,
    "id" | "title" | "messages" | "proposedPlans" | "modelSelection" | "branch" | "worktreePath"
  >;
  readonly folderName: string;
  readonly member: FolderMember | null;
  readonly writtenAt: string;
}): string {
  const { thread, member } = input;
  const exchanges = collectExchanges(thread.messages);
  const rendered = exchanges.map(renderExchange);
  // Keep the first request, which usually states the goal, and as many of the
  // latest exchanges as fit.
  let omitted = 0;
  while (rendered.length > 2 && rendered.join("\n\n").length > MAX_DIGEST_CHARS) {
    rendered.splice(1, 1);
    omitted += 1;
  }
  if (omitted > 0) {
    rendered.splice(1, 0, `_${omitted} earlier exchange${omitted === 1 ? "" : "s"} omitted._`);
  }

  const latestPlan = [...thread.proposedPlans].sort((a, b) =>
    a.updatedAt.localeCompare(b.updatedAt),
  )[thread.proposedPlans.length - 1];
  const base = member?.baseBranch;
  const inspect = base
    ? `Inspect the work so far with \`git log ${base}..HEAD\` and \`git diff ${base}...HEAD\`.`
    : "Inspect the work so far with `git log` and `git diff`.";

  return [
    `# Handoff: ${thread.title}`,
    "",
    `- From thread: ${thread.title} (\`${thread.id}\`), ${thread.modelSelection.model}`,
    `- Folder: ${input.folderName}`,
    ...(member
      ? [`- Repository: ${member.repoName} on \`${member.branch}\` (base \`${member.baseBranch}\`)`]
      : thread.branch
        ? [`- Branch: \`${thread.branch}\``]
        : []),
    ...(thread.worktreePath ? [`- Worktree: ${thread.worktreePath}`] : []),
    `- Written: ${input.writtenAt}`,
    "",
    "## How to continue",
    "",
    `Read this note, then plan.md and todos.md in the same .context directory. ${inspect} The digest below records what was asked and what the previous agent reported; verify claims against the code before relying on them.`,
    "",
    ...(latestPlan ? ["## Latest plan", "", latestPlan.planMarkdown.trim(), ""] : []),
    "## Conversation digest",
    "",
    rendered.length > 0 ? rendered.join("\n\n") : "_The thread has no messages yet._",
    "",
  ].join("\n");
}

/** `2026-09-22-1430-title-slug.md`, sortable and unique enough per thread. */
export function handoffFileName(title: string, writtenAt: string): string {
  const stamp = writtenAt.slice(0, 16).replace("T", "-").replace(":", "");
  const slug = slugifyFolderName(title) || "thread";
  return `${stamp}-${slug}.md`;
}

/** `plans/<date>-<title>-<id>.md`: one file per proposed plan, rewritten as it changes. */
export function planFileName(input: {
  readonly planId: string;
  readonly createdAt: string;
  readonly threadTitle: string;
}): string {
  const stamp = input.createdAt.slice(0, 16).replace("T", "-").replace(":", "");
  const slug = slugifyFolderName(input.threadTitle).slice(0, 40) || "plan";
  const id = input.planId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "plan";
  return `${stamp}-${slug}-${id}.md`;
}

/** A proposed plan as saved to `.context`, noting where it came from. */
export function renderPlanFile(input: {
  readonly planMarkdown: string;
  readonly threadTitle: string;
  readonly repoName: string | null;
  readonly fileName: string | null;
}): string {
  const where = input.repoName === null ? "the folder session" : `the ${input.repoName} repository`;
  const source = input.fileName ? `, saved as plans/${input.fileName}` : "";
  return `<!-- Proposed in "${input.threadTitle}" (${where})${source}. -->\n\n${input.planMarkdown.trim()}\n`;
}
