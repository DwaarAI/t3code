# Folders

A folder groups the work for one feature across repositories. It holds one worktree per
repository on a shared branch, the threads working in those worktrees, and a `.context`
directory the threads share for plans, todos, handoff notes, and review findings.

Create and manage folders on web and desktop. In the mobile app, the folder button on the
home screen opens your folders, where you can see each folder's threads and start a new
one in a repository's worktree or as a folder session. Folder threads also appear in the
regular thread list. A thread started on mobile does not run the project's worktree setup
script, so send the first message in a new folder worktree from web or desktop if the
project needs one.

## Create a folder

Choose **+** next to **Folders** in the sidebar, or **New folder** in the command palette
(`Cmd/Ctrl+K`). Name the folder, pick its repositories, and choose a base branch for each.
Each repository gets a worktree on `feat/<folder-name>`, or on the branch you enter. If that
branch already exists in a repository, the folder checks it out instead of creating it.

New branches start from the latest `origin/<base>`, fetched first, so a worktree is current even
when your checkout of the base branch is behind; the checkout itself is not changed. Every new or
restored worktree also gets copies of the project's untracked `.env*` files, which git leaves out
of worktrees. Hover over a repository in the sidebar to see where its branch started and which
files were copied. After you change them in the project, choose **Copy .env files** from the
repository's menu to copy them again.

A new thread opens in the first repository, ready for your first prompt. The first thread
started in each worktree runs the project's setup script, the same as **New worktree**.

To add a repository later, choose **Add repository…** from the folder's menu.

## Work in a folder

Each repository appears under its folder in the sidebar. Choose one to open its latest thread,
or **+** to start a new one. Threads in a worktree appear as tabs above the conversation, and
**+** in the tab bar starts another thread in the same worktree with any provider. Folder
threads don't appear in the main thread list.

Threads in a worktree share its files. Run edits that could overlap one at a time, and use
parallel threads for testing, review, and questions.

## Work across repositories

**All repositories**, at the top of each folder, holds its folder sessions. A folder session's
working directory is the folder itself, so the agent sees every repository side by side and can
plan or change work that spans them; tell it which repository each change belongs in. Choose
**All repositories** to open the latest folder session, **+** beside it to start one, or **New
folder session** from the folder's menu. Folder sessions have their own tabs, and the Android
and iOS apps list them under a project named after the folder.

Agents in a repository's thread can also read the folder's other repositories, and are asked
to change only their own unless you say otherwise.

## Plan with plan mode

Switch the composer to plan mode, in a folder session to plan across repositories or in a
repository's thread to plan within it. When the agent finishes a plan, T3 Code saves it to
`.context/plans/` and makes it the folder's `.context/plan.md`, so every thread in the folder,
including ones you start later, works from the same plan. Marking an older plan implemented
does not replace a newer `plan.md`.

## Share context between threads

Every folder has a `.context` directory next to its worktrees:

| Path        | Use                                            |
| ----------- | ---------------------------------------------- |
| `plan.md`   | The current plan.                              |
| `plans/`    | Every plan proposed in plan mode.              |
| `todos.md`  | Open and finished tasks.                       |
| `handoffs/` | Notes written when work moves to a new thread. |
| `reviews/`  | Review findings.                               |

Each repository worktree also links it as `.context`, so the notes are reachable from inside the
repository. Git ignores the link through the repository's local exclude file, so it never shows up
as a change. Agents in a folder are told where `.context` is and are asked to read it before
starting and keep `plan.md` and `todos.md` current. Nothing in `.context` is committed to your
repositories. To attach a file from it, type `@` in the composer and search for its name.

## Hand off to a new thread

When a thread's context is full, or you want a fresh thread for a side task, choose **Handoff**
in the tab bar, or **Continue in new thread (handoff)** from the thread's menu. T3 Code writes a
handoff note to `.context/handoffs/` with the latest plan and a digest of the conversation, then
opens a new thread in the same worktree with the note attached. Pick any provider, for example
Codex to review work Claude implemented, and add your instruction.

## Review with Codex

Choose **Review** in the tab bar, or **Review in a new Codex session** from any thread's menu. T3
Code opens a new thread in the same worktree or folder session, switches it to Codex, and fills
in a review request against the branch's base that uses the built-in `$t3:dwaar-code-reviewer`
skill. Send it as is or add what to focus on. The reviewer lists its findings, saves them to
`.context/reviews/` in a folder, and posts them to the branch's pull request only when you ask.
If Codex is not set up on that machine, the draft keeps the current provider.

## Reusable guides

Markdown files in the `guides` directory of your T3 Code home (`~/.t3/guides` by default) can be
attached to any thread. Type `@` in the composer and search for the file name. Add your own
guides, such as team conventions.

## Work from GitHub issues

To link a folder to an issue, paste the issue URL into **GitHub issue** when you create
the folder. T3 Code saves the issue, and its parent issue if it's a sub-issue, to
`.context/issue.md`. It comments on the issue with the folder's name and branches and
labels it `status:in-progress`. Agents in the folder read the issue, and post progress on it
with the GitHub CLI.

Use the folder's menu to open the issue or mark it in progress, in review, or done. When a
pull request opens from the folder's branch, the issue moves to `status:in-review`; when the
pull requests merge, it moves to `status:done`. Automatic changes never move an issue back.

To create folders from GitHub, turn on **Settings → Source Control → Create folders from
GitHub issues**. Every two minutes, open issues labeled `t3` in your projects' GitHub
repositories become folders, as long as the issue's author can push to the repository. The
label then changes to `t3:active`, or to `t3:error` with a comment explaining the problem.
Nothing runs until you open the folder: its first thread starts with a suggested prompt.

For a phased feature, create a sub-issue for each phase and label each one. Each phase gets
its own folder, and its agents can read the parent issue for the overall goal.

Add a `t3` block to the issue body to shape the folder. Every line is optional:

````markdown
```t3
name: Checkout flow
repos: acme/api, acme/web
branch: feat/checkout
base: main
prompt: |
  Plan the checkout flow in .context/plan.md before changing code.
```
````

`repos` defaults to the issue's own repository, `base` to each repository's default branch,
and `name` to the issue number and title. Each repository must already be a project in T3
Code. GitHub access uses the GitHub CLI signed in on the machine running T3 Code; see
[source control](./source-control.md#github).

## Archive and restore

Choose **Archive worktree** from a repository's menu, or **Archive folder** from the folder's
menu, when the work is done. Archiving removes the worktree from disk, keeps its branch, and
settles its threads. If a worktree has uncommitted changes, T3 Code asks before discarding them.

Archived folders move to **Archived folders** in the sidebar. **Restore folder** or
**Restore worktree** checks the branch out again in the same place.
