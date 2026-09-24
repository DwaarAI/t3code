/**
 * Pure layout rules for feature folders: where things live on disk, what a new
 * `.context/` contains, what agents are told about it, and how a handoff note
 * is rendered from a thread. FolderService does the IO.
 */
import type { FolderMember, OrchestrationThread } from "@t3tools/contracts";
import type * as Path from "effect/Path";

export const FOLDER_MANIFEST_FILE = "folder.json";
export const FOLDER_CONTEXT_DIR = ".context";
export const FOLDER_CONTEXT_SUBDIRS = ["handoffs", "reviews"] as const;

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
  readonly repoName: string;
}

/**
 * A cwd belongs to a folder when it sits inside `<foldersDir>/<slug>/<repo>`.
 * String math on server-produced absolute paths, so provider adapters can call
 * it on every session start without extra services.
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
  if (!slug || !repoName || slug === ".." || repoName === ".." || repoName === FOLDER_CONTEXT_DIR) {
    return null;
  }
  const folderDir = `${foldersDir.replace(/[\\/]+$/, "")}${sep}${slug}`;
  return { slug, folderDir, contextDir: `${folderDir}${sep}${FOLDER_CONTEXT_DIR}`, repoName };
}

export interface FolderSessionContext {
  /** Appended to the provider's system or developer instructions. */
  readonly instructions: string;
  /** Directories outside the cwd the agent needs to write (the folder's .context). */
  readonly writableDirs: ReadonlyArray<string>;
}

/** What a provider session in `cwd` should know and be granted, or null outside folders. */
export function resolveFolderSessionContext(
  cwd: string | undefined,
  config: { readonly foldersDir: string; readonly guidesDir: string },
): FolderSessionContext | null {
  const scope = resolveFolderScope(cwd, config.foldersDir);
  if (scope === null) return null;
  return {
    instructions: buildFolderInstructions({ scope, guidesDir: config.guidesDir }),
    writableDirs: [scope.contextDir],
  };
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

export const SEED_GUIDES: Record<string, string> = {
  "code-review.md": `# Code review guidelines

Review the change against its goal, not against your own preferences.

1. **Correctness.** Trace the changed code paths with realistic inputs. Look for
   off-by-one errors, unhandled empty or null states, races, and error paths that
   swallow failures.
2. **Scope.** Flag changes unrelated to the goal and missing pieces the goal needs,
   such as a way back out of a new state.
3. **Tests.** Behavior changes need tests that fail without the change. Tests that
   mirror the implementation do not count.
4. **Simplicity.** Point out duplicated logic and machinery the change does not need.
5. **Performance and security.** Note unbounded work, repeated IO in loops, and
   untrusted input reaching a shell, a query, or the filesystem.

Report each finding with the file and line, what goes wrong, and a concrete fix.
Rank findings from most to least severe. Say so plainly when you find nothing.
`,
};

/** Runtime instructions telling an agent about the folder its cwd belongs to. */
function buildFolderInstructions(input: {
  readonly scope: FolderScope;
  readonly guidesDir: string;
}): string {
  const { scope } = input;
  return `<t3_folder>
This thread works in the "${scope.repoName}" repository of the T3 Code folder "${scope.slug}". A folder groups the worktrees of one feature across repositories; ${FOLDER_MANIFEST_FILE} in ${scope.folderDir} lists them with their branches.
Shared notes for the whole feature live in ${scope.contextDir}. Read README.md, plan.md, todos.md, and the newest file in handoffs/ before starting. Keep plan.md and todos.md current as work progresses, and write review findings to reviews/. Never copy these notes into a repository.
When ${scope.contextDir}/issue.md exists, the folder works on that GitHub issue: read it and its parent issue, and post progress on the issue with gh as milestones land.
Reusable guidelines, such as review checklists, are in ${input.guidesDir}.
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
