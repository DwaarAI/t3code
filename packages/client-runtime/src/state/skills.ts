import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/**
 * Skills live on the server under `<T3 home>/skills`. Clients read them with a
 * query, fetch one skill's files on demand for editing, and refresh the list
 * after each mutation.
 */
export function createSkillEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:skills:list",
    tag: WS_METHODS.skillsList,
    staleTimeMs: 15_000,
  });
  const scheduler = createAtomCommandScheduler();
  // Mutations move and replace skill folders; run them in order per environment.
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: EnvironmentId }) => environmentId,
  };
  const refreshList = (
    target: { readonly environmentId: EnvironmentId },
    registry: { readonly refresh: (atom: Atom.Atom<unknown>) => void },
  ) =>
    Effect.sync(() => registry.refresh(list({ environmentId: target.environmentId, input: {} })));

  const mutation = <TTag extends MutationTag>(tag: TTag, name: string) =>
    createEnvironmentRpcCommand(runtime, {
      label: `environment-data:skills:${name}`,
      tag,
      scheduler,
      concurrency,
      onSettled: refreshList,
    });

  return {
    list,
    get: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:skills:get",
      tag: WS_METHODS.skillsGet,
    }),
    save: mutation(WS_METHODS.skillsSave, "save"),
    delete: mutation(WS_METHODS.skillsDelete, "delete"),
    setEnabled: mutation(WS_METHODS.skillsSetEnabled, "set-enabled"),
  };
}

type MutationTag =
  | typeof WS_METHODS.skillsSave
  | typeof WS_METHODS.skillsDelete
  | typeof WS_METHODS.skillsSetEnabled;
