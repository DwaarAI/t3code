import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, Folder, ProjectId } from "@t3tools/contracts";
import { useEffect, useId, useMemo, useState } from "react";
import { create } from "zustand";

import { useStartFolderThread } from "../../hooks/useStartFolderThread";
import { useProjects, useServerConfigs } from "../../state/entities";
import { folderEnvironment, useEnvironmentFolders } from "../../state/folders";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";

type Request = {
  readonly environmentId: EnvironmentId | null;
  /** Set to add repositories to an existing folder instead of creating one. */
  readonly addTo: Folder | null;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

/** Opens the dialog; the sidebar, command palette, and keybinding all go through here. */
export function openCreateFolderDialog(environmentId?: EnvironmentId) {
  useRequest.setState({ request: { environmentId: environmentId ?? null, addTo: null } });
}

export function openAddRepositoryDialog(environmentId: EnvironmentId, folder: Folder) {
  useRequest.setState({ request: { environmentId, addTo: folder } });
}

function close() {
  useRequest.setState({ request: null });
}

export function CreateFolderDialogHost() {
  const request = useRequest((state) => state.request);
  useEffect(() => () => close(), []);
  return request ? (
    <CreateFolderDialog initialEnvironmentId={request.environmentId} addTo={request.addTo} />
  ) : null;
}

/** One line per repository: where its branch started and which env files it got. */
function describeFolderSetup(folder: Folder): string {
  return folder.members
    .map((member) => {
      const base = member.setup?.baseRef ? `from ${member.setup.baseRef}` : `on ${member.branch}`;
      const envCount = member.setup?.envFiles.length ?? 0;
      const env =
        envCount === 0 ? "no .env files" : `${envCount} .env file${envCount === 1 ? "" : "s"}`;
      return `${member.repoName}: ${base}, ${env}`;
    })
    .join("; ");
}

function slugPreview(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function CreateFolderDialog(props: {
  initialEnvironmentId: EnvironmentId | null;
  addTo: Folder | null;
}) {
  const { addTo } = props;
  const id = useId();
  const environments = useEnvironmentFolders();
  const serverConfigs = useServerConfigs();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    props.initialEnvironmentId ?? environments[0]?.environmentId ?? null,
  );
  const allProjects = useProjects();
  const projects = useMemo(
    () =>
      allProjects
        .filter(
          (project) =>
            project.environmentId === environmentId &&
            !addTo?.members.some((member) => member.projectId === project.id),
        )
        .toSorted((a, b) => a.title.localeCompare(b.title)),
    [addTo, allProjects, environmentId],
  );
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [baseBranches, setBaseBranches] = useState<ReadonlyMap<ProjectId, string | null>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const createFolder = useAtomCommand(folderEnvironment.create, { reportFailure: false });
  const addMember = useAtomCommand(folderEnvironment.addMember, { reportFailure: false });
  const startFolderThread = useStartFolderThread();
  const [issue, setIssue] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");

  const slug = slugPreview(name);
  const selected = [...baseBranches.entries()];
  const ready =
    environmentId !== null &&
    (addTo !== null || slug.length > 0) &&
    selected.length > 0 &&
    selected.every(([, base]) => base !== null);

  const submit = async () => {
    if (!ready || environmentId === null) return;
    setSubmitting(true);
    setError(null);
    if (addTo !== null) {
      // One at a time: each add rewrites the folder manifest.
      for (const [projectId, baseBranch] of selected) {
        const added = await addMember({
          environmentId,
          input: { slug: addTo.slug, member: { projectId, baseBranch: baseBranch! } },
        });
        if (added._tag === "Failure") {
          setSubmitting(false);
          if (!isAtomCommandInterrupted(added)) {
            const failure = squashAtomCommandFailure(added);
            setError(failure instanceof Error ? failure.message : "Could not add the repository.");
          }
          return;
        }
      }
      setSubmitting(false);
      close();
      return;
    }
    const result = await createFolder({
      environmentId,
      input: {
        name: name.trim(),
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        ...(issue.trim() ? { issue: issue.trim() } : {}),
        ...(initialPrompt.trim() ? { initialPrompt: initialPrompt.trim() } : {}),
        members: selected.map(([projectId, baseBranch]) => ({
          projectId,
          baseBranch: baseBranch!,
        })),
      },
    });
    setSubmitting(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "Could not create the folder.");
      }
      return;
    }
    close();
    const { folder } = result.value;
    toastManager.add({
      type: "success",
      title: `Created ${folder.name}`,
      description: describeFolderSetup(folder),
    });
    // Land in the first repository so the initial prompt can go straight in.
    const first = folder.members[0];
    if (first) {
      await settlePromise(() => startFolderThread(environmentId, folder, first));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{addTo ? `Add repositories to ${addTo.name}` : "New folder"}</DialogTitle>
            <DialogDescription>
              {addTo
                ? `Each repository gets a worktree on ${addTo.members[0]?.branch ?? "the folder's branch"}.`
                : "A folder groups one worktree per repository for a feature. Its threads share a .context directory for plans, todos, handoffs, and reviews."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              {environments.length > 1 && addTo === null ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-environment`}>Environment</Label>
                  <Select
                    value={environmentId ?? ""}
                    onValueChange={(value) => {
                      setEnvironmentId(value as EnvironmentId);
                      setBaseBranches(new Map());
                    }}
                  >
                    <SelectTrigger id={`${id}-environment`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {environments.map((environment) => (
                        <SelectItem
                          key={environment.environmentId}
                          value={environment.environmentId}
                        >
                          {serverConfigs.get(environment.environmentId)?.environment.label ??
                            environment.environmentId}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}
              {addTo === null ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-name`}>Name</Label>
                    <Input
                      id={`${id}-name`}
                      autoFocus
                      value={name}
                      placeholder="Auth revamp"
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-branch`}>Branch</Label>
                    <Input
                      id={`${id}-branch`}
                      value={branch}
                      placeholder={slug ? `feat/${slug}` : "feat/<name>"}
                      onChange={(event) => setBranch(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-issue`}>GitHub issue (optional)</Label>
                    <Input
                      id={`${id}-issue`}
                      value={issue}
                      placeholder="https://github.com/owner/repo/issues/12"
                      onChange={(event) => setIssue(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-prompt`}>First prompt (optional)</Label>
                    <Textarea
                      id={`${id}-prompt`}
                      value={initialPrompt}
                      placeholder="Starts each repository's first thread."
                      onChange={(event) => setInitialPrompt(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 font-medium">Repositories</legend>
                {projects.length === 0 ? (
                  <p className="text-muted-foreground">
                    {addTo ? "Every project is already in this folder." : "Add a project first."}
                  </p>
                ) : (
                  projects.map((project) => (
                    <RepositoryRow
                      key={project.id}
                      project={project}
                      environmentLabel={
                        serverConfigs.get(project.environmentId)?.environment.label ?? null
                      }
                      baseBranch={baseBranches.get(project.id)}
                      onChange={(next) =>
                        setBaseBranches((current) => {
                          const updated = new Map(current);
                          if (next === undefined) updated.delete(project.id);
                          else updated.set(project.id, next);
                          return updated;
                        })
                      }
                    />
                  ))
                )}
              </fieldset>
              {error ? <p className="text-destructive-foreground">{error}</p> : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || submitting}>
              {submitting ? "Working…" : addTo ? "Add repositories" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * One selectable repository. `baseBranch` is undefined when unselected and
 * null while its branches load.
 */
function RepositoryRow(props: {
  project: EnvironmentProject;
  environmentLabel: string | null;
  baseBranch: string | null | undefined;
  onChange: (baseBranch: string | null | undefined) => void;
}) {
  const { project, baseBranch, onChange } = props;
  const selected = baseBranch !== undefined;
  const refs = useEnvironmentQuery(
    selected
      ? vcsEnvironment.listRefs({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot, refKind: "local", limit: 100 },
        })
      : null,
  );
  const branches = useMemo(() => refs.data?.refs ?? [], [refs.data]);

  // Default to the repository's default branch once the list arrives.
  useEffect(() => {
    if (baseBranch !== null || branches.length === 0) return;
    const preferred =
      branches.find((ref) => ref.isDefault) ?? branches.find((ref) => ref.current) ?? branches[0];
    if (preferred) onChange(preferred.name);
  }, [baseBranch, branches, onChange]);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onChange(checked === true ? null : undefined)}
        />
        <Tooltip>
          <TooltipTrigger render={<span className="truncate" />}>{project.title}</TooltipTrigger>
          <TooltipPopup side="right">
            <span className="font-mono">{project.workspaceRoot}</span>
            {props.environmentLabel ? (
              <span className="block text-muted-foreground">on {props.environmentLabel}</span>
            ) : null}
          </TooltipPopup>
        </Tooltip>
      </label>
      {selected ? (
        <div className="w-44 shrink-0">
          <Select
            value={baseBranch ?? ""}
            onValueChange={(value) => {
              if (typeof value === "string" && value) onChange(value);
            }}
          >
            <SelectTrigger aria-label={`Base branch for ${project.title}`}>
              <SelectValue placeholder={refs.isPending ? "Loading…" : "Base branch"} />
            </SelectTrigger>
            <SelectPopup>
              {branches.map((ref) => (
                <SelectItem key={ref.name} value={ref.name}>
                  {ref.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
