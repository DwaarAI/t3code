/**
 * GitHub Actions right-panel surface for the branch checked out in a thread's
 * workspace: its recent workflow runs, polled while the panel is open, and the
 * workflows it can start by hand. Status marks are static; nothing animates.
 */
import {
  latestRunPerWorkflow,
  workflowRunState,
  type WorkflowRunState,
} from "@t3tools/client-runtime/state/githubActions";
import type {
  EnvironmentId,
  GitHubDispatchableWorkflow,
  GitHubWorkflowRun,
} from "@t3tools/contracts";
import {
  CircleCheck,
  CircleDot,
  CircleMinus,
  CircleSlash,
  CircleX,
  EllipsisIcon,
  ExternalLink,
  Play,
  RefreshCw,
} from "lucide-react";
import { useId, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { githubActionsEnvironment } from "~/state/githubActions";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const RUN_STATE_VISUALS: Record<
  WorkflowRunState,
  { readonly icon: typeof CircleCheck; readonly className: string; readonly label: string }
> = {
  running: { icon: CircleDot, className: "text-info", label: "Running" },
  success: { icon: CircleCheck, className: "text-success", label: "Succeeded" },
  failure: { icon: CircleX, className: "text-destructive", label: "Failed" },
  cancelled: { icon: CircleSlash, className: "text-muted-foreground", label: "Cancelled" },
  skipped: { icon: CircleMinus, className: "text-muted-foreground", label: "Skipped" },
};

function RunStateIcon({ state }: { state: WorkflowRunState }) {
  const visual = RUN_STATE_VISUALS[state];
  const Icon = visual.icon;
  return <Icon aria-label={visual.label} className={cn("size-3.5 shrink-0", visual.className)} />;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="px-1.5 pt-1 text-[.65rem] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function PanelMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-64 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function GitHubActionsPanel({
  environmentId,
  cwd,
}: {
  environmentId: EnvironmentId;
  cwd: string;
}) {
  const query = useEnvironmentQuery(
    githubActionsEnvironment.list({ environmentId, input: { cwd } }),
  );
  const cancel = useAtomCommand(githubActionsEnvironment.cancel);
  const rerun = useAtomCommand(githubActionsEnvironment.rerun);
  const [dispatching, setDispatching] = useState<GitHubDispatchableWorkflow | null>(null);
  const [showAll, setShowAll] = useState(false);
  const data = query.data;
  const runs = useMemo(() => {
    if (!data) return [];
    return showAll ? data.runs : latestRunPerWorkflow(data.runs);
  }, [data, showAll]);

  if (!data) {
    return query.error ? (
      <PanelMessage title="Could not load GitHub Actions" detail={query.error} />
    ) : (
      <PanelMessage title="Loading GitHub Actions…" detail="Reading this branch's workflow runs." />
    );
  }
  if (data.repository === null) {
    return (
      <PanelMessage
        title="Not a GitHub repository"
        detail="GitHub Actions appear here when this branch's remote is on GitHub."
      />
    );
  }
  if (data.branch === null) {
    return (
      <PanelMessage
        title="No branch checked out"
        detail="Check out a branch to see and run its workflows."
      />
    );
  }

  const branch = data.branch;
  const actionsUrl = `https://github.com/${data.repository}/actions?query=${encodeURIComponent(`branch:${branch}`)}`;

  const onCancel = async (run: GitHubWorkflowRun) => {
    const result = await cancel({ environmentId, input: { cwd, runId: run.id } });
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: `Cancelling ${run.workflowName}` });
    }
  };
  const onRerun = async (run: GitHubWorkflowRun, failedOnly: boolean) => {
    const result = await rerun({ environmentId, input: { cwd, runId: run.id, failedOnly } });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: failedOnly
          ? `Re-running failed jobs of ${run.workflowName}`
          : `Re-running ${run.workflowName}`,
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{branch}</p>
          <p className="truncate text-xs text-muted-foreground">{data.repository}</p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Refresh runs"
                disabled={query.isPending}
                onClick={query.refresh}
              />
            }
          >
            <RefreshCw />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Refresh runs</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Open on GitHub"
                render={<a href={actionsUrl} target="_blank" rel="noopener noreferrer" />}
              />
            }
          >
            <ExternalLink />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Open on GitHub</TooltipPopup>
        </Tooltip>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {!data.pushed ? (
            <p className="rounded-md bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
              {branch} is not pushed yet. Push it to run workflows on it.
            </p>
          ) : null}
          {query.error ? (
            <p className="px-1.5 text-xs text-destructive-foreground">{query.error}</p>
          ) : null}
          {data.workflows.length > 0 ? (
            <section className="flex flex-col gap-0.5">
              <SectionTitle>Run a workflow</SectionTitle>
              {data.workflows.map((workflow) => (
                <div
                  key={workflow.path}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{workflow.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{workflow.path}</p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!data.pushed}
                    onClick={() => setDispatching(workflow)}
                  >
                    <Play />
                    Run
                  </Button>
                </div>
              ))}
            </section>
          ) : null}
          <section className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between gap-2 pr-1">
              <SectionTitle>{showAll ? "All runs" : "Latest runs"}</SectionTitle>
              {data.runs.length > 0 ? (
                <Button size="xs" variant="ghost-muted" onClick={() => setShowAll(!showAll)}>
                  {showAll ? "Latest per workflow" : `All ${data.runs.length}`}
                </Button>
              ) : null}
            </div>
            {runs.length === 0 ? (
              <p className="px-1.5 text-xs text-muted-foreground">
                {data.pushed ? "No workflow runs on this branch yet." : "No runs yet."}
              </p>
            ) : (
              runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  onCancel={() => void onCancel(run)}
                  onRerun={(failedOnly) => void onRerun(run, failedOnly)}
                />
              ))
            )}
          </section>
        </div>
      </ScrollArea>
      {dispatching ? (
        <DispatchDialog
          key={dispatching.path}
          environmentId={environmentId}
          cwd={cwd}
          branch={branch}
          workflow={dispatching}
          onClose={() => setDispatching(null)}
        />
      ) : null}
    </div>
  );
}

function RunRow({
  run,
  onCancel,
  onRerun,
}: {
  run: GitHubWorkflowRun;
  onCancel: () => void;
  onRerun: (failedOnly: boolean) => void;
}) {
  const state = workflowRunState(run);
  const attempt = run.attempt > 1 ? ` · attempt ${run.attempt}` : "";
  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50">
      <RunStateIcon state={state} />
      <a
        href={run.url}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 focus-visible:outline-hidden"
      >
        <p className="truncate text-sm">
          {run.workflowName}
          <span className="text-muted-foreground"> · {run.title}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          #{run.number} · {run.event} · {run.headSha.slice(0, 7)} ·{" "}
          {RUN_STATE_VISUALS[state].label.toLowerCase()} {formatRelativeTimeLabel(run.updatedAt)}
          {attempt}
        </p>
      </a>
      <Menu>
        <MenuTrigger
          render={
            <Button size="icon-xs" variant="ghost" aria-label={`Actions for run #${run.number}`} />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem render={<a href={run.url} target="_blank" rel="noopener noreferrer" />}>
            Open on GitHub
          </MenuItem>
          {state === "running" ? <MenuItem onClick={onCancel}>Cancel run</MenuItem> : null}
          {state === "failure" ? (
            <MenuItem onClick={() => onRerun(true)}>Re-run failed jobs</MenuItem>
          ) : null}
          {state !== "running" ? (
            <MenuItem onClick={() => onRerun(false)}>Re-run all jobs</MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </div>
  );
}

function DispatchDialog({
  environmentId,
  cwd,
  branch,
  workflow,
  onClose,
}: {
  environmentId: EnvironmentId;
  cwd: string;
  branch: string;
  workflow: GitHubDispatchableWorkflow;
  onClose: () => void;
}) {
  const id = useId();
  const dispatch = useAtomCommand(githubActionsEnvironment.dispatch);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(workflow.inputs.map((input) => [input.name, input.default ?? ""])),
  );
  const [submitting, setSubmitting] = useState(false);
  const missing = workflow.inputs.some((input) => input.required && !values[input.name]);
  const setValue = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const submit = async () => {
    setSubmitting(true);
    const result = await dispatch({
      environmentId,
      input: { cwd, workflow: workflow.path, inputs: values },
    });
    setSubmitting(false);
    if (result._tag !== "Success") return;
    toastManager.add({
      type: "success",
      title: `Started ${workflow.name}`,
      description: "The run shows up here within a few seconds.",
    });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Run {workflow.name}</DialogTitle>
            <DialogDescription>
              Starts {workflow.path} on {branch}.
            </DialogDescription>
          </DialogHeader>
          {workflow.inputs.length > 0 ? (
            <DialogPanel>
              <div className="flex flex-col gap-4">
                {workflow.inputs.map((input) => {
                  const fieldId = `${id}-${input.name}`;
                  const label = `${input.name}${input.required ? "" : " (optional)"}`;
                  return (
                    <div key={input.name} className="flex flex-col gap-1.5">
                      {input.type === "boolean" ? (
                        <div className="flex items-center justify-between gap-3">
                          <Label htmlFor={fieldId}>{label}</Label>
                          <Switch
                            id={fieldId}
                            checked={values[input.name] === "true"}
                            onCheckedChange={(checked) =>
                              setValue(input.name, checked ? "true" : "false")
                            }
                          />
                        </div>
                      ) : input.type === "choice" && input.options.length > 0 ? (
                        <>
                          <Label htmlFor={fieldId}>{label}</Label>
                          <Select
                            value={values[input.name] ?? ""}
                            onValueChange={(value) => setValue(input.name, String(value ?? ""))}
                          >
                            <SelectTrigger id={fieldId}>
                              <SelectValue placeholder="Choose…" />
                            </SelectTrigger>
                            <SelectPopup>
                              {input.options.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        </>
                      ) : (
                        <>
                          <Label htmlFor={fieldId}>{label}</Label>
                          <Input
                            id={fieldId}
                            type={input.type === "number" ? "number" : "text"}
                            value={values[input.name] ?? ""}
                            onChange={(event) => setValue(input.name, event.target.value)}
                          />
                        </>
                      )}
                      {input.description ? (
                        <p className="text-xs text-muted-foreground">{input.description}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </DialogPanel>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={missing || submitting}>
              {submitting ? "Starting…" : "Run workflow"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
