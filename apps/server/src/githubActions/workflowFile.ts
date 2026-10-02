/**
 * Pure reading of GitHub Actions workflow files and `gh run list` output.
 */
import type {
  GitHubDispatchableWorkflow,
  GitHubWorkflowInput,
  GitHubWorkflowInputType,
  GitHubWorkflowRun,
} from "@t3tools/contracts";
import { parse } from "yaml";

const INPUT_TYPES: ReadonlyArray<GitHubWorkflowInputType> = [
  "string",
  "boolean",
  "choice",
  "number",
  "environment",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const scalarString = (value: unknown): string | null =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : null;

/** The `workflow_dispatch` trigger's config, `{}` when declared bare, null when absent. */
function dispatchTrigger(on: unknown): Record<string, unknown> | null {
  if (on === "workflow_dispatch") return {};
  if (Array.isArray(on)) return on.includes("workflow_dispatch") ? {} : null;
  if (!isRecord(on) || !("workflow_dispatch" in on)) return null;
  const trigger = on.workflow_dispatch;
  return isRecord(trigger) ? trigger : {};
}

function readInputs(trigger: Record<string, unknown>): GitHubWorkflowInput[] {
  if (!isRecord(trigger.inputs)) return [];
  return Object.entries(trigger.inputs).flatMap(([name, raw]) => {
    const spec = isRecord(raw) ? raw : {};
    const declared = typeof spec.type === "string" ? spec.type : "string";
    const type = INPUT_TYPES.find((candidate) => candidate === declared) ?? "string";
    const trimmed = name.trim();
    if (trimmed.length === 0) return [];
    return [
      {
        name: trimmed,
        description: typeof spec.description === "string" ? spec.description : null,
        type,
        required: spec.required === true,
        default: scalarString(spec.default),
        options: Array.isArray(spec.options)
          ? spec.options.flatMap((option) => scalarString(option) ?? [])
          : [],
      },
    ];
  });
}

/**
 * The manual trigger a workflow file declares, or null when it cannot be
 * started by hand. Unparseable files are skipped rather than failing the list.
 */
export function readDispatchableWorkflow(
  path: string,
  source: string,
): GitHubDispatchableWorkflow | null {
  let document: unknown;
  try {
    document = parse(source);
  } catch {
    return null;
  }
  if (!isRecord(document)) return null;
  const trigger = dispatchTrigger(document.on);
  if (trigger === null) return null;
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const name = typeof document.name === "string" ? document.name.trim() : "";
  return { path, name: name.length > 0 ? name : fileName, inputs: readInputs(trigger) };
}

/** Workflow files GitHub reads: YAML directly inside `.github/workflows`. */
export const isWorkflowFileName = (name: string) => /\.ya?ml$/i.test(name);

/**
 * Dispatch inputs for `gh workflow run --json`: declared inputs only, with
 * empty optional values dropped so the workflow's own defaults apply.
 */
export function dispatchInputs(
  workflow: GitHubDispatchableWorkflow,
  values: Readonly<Record<string, string>>,
): { readonly inputs: Record<string, string> } | { readonly missing: string } {
  const inputs: Record<string, string> = {};
  for (const input of workflow.inputs) {
    const value = values[input.name] ?? input.default ?? "";
    if (value === "") {
      if (input.required) return { missing: input.name };
      continue;
    }
    inputs[input.name] = value;
  }
  return { inputs };
}

export const RUN_LIST_FIELDS =
  "databaseId,number,attempt,workflowName,displayTitle,event,status,conclusion,headSha,url,createdAt,updatedAt";

/** Maps one `gh run list --json` row; `gh` reports a pending conclusion as "". */
export function toWorkflowRun(row: {
  readonly databaseId: number;
  readonly number: number;
  readonly attempt: number;
  readonly workflowName: string;
  readonly displayTitle: string;
  readonly event: string;
  readonly status: string;
  readonly conclusion: string;
  readonly headSha: string;
  readonly url: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}): GitHubWorkflowRun {
  return {
    id: row.databaseId,
    number: row.number,
    attempt: row.attempt,
    workflowName: row.workflowName,
    title: row.displayTitle,
    event: row.event,
    status: row.status,
    conclusion: row.conclusion === "" ? null : row.conclusion,
    headSha: row.headSha,
    url: row.url,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Where a local branch's runs live: its upstream remote and branch when it
 * tracks one, else the same-named branch on the fallback (push or primary) remote.
 */
export function resolveRemoteBranch(input: {
  readonly branch: string;
  readonly upstreamRemote: string | null;
  readonly upstreamMerge: string | null;
  readonly fallbackRemote: string;
}): { readonly remote: string; readonly branch: string } {
  const merge = input.upstreamMerge?.replace(/^refs\/heads\//, "") ?? "";
  if (input.upstreamRemote && input.upstreamRemote !== "." && merge.length > 0) {
    return { remote: input.upstreamRemote, branch: merge };
  }
  return { remote: input.fallbackRemote, branch: input.branch };
}
