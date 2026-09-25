import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { findFolderForThread } from "@t3tools/client-runtime/state/folders";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useServerConfigs } from "../state/entities";
import { useEnvironmentFolders } from "../state/folders";
import { useNewThreadHandler } from "./useHandleNewThread";

const CODEX = ProviderDriverKind.make("codex");
/** The server's built-in review skill, published under the `t3` plugin namespace. */
const REVIEW_SKILL = "t3:dwaar-code-reviewer";

/** A Codex instance that can take a turn now, on its default model. */
export function pickReviewModel(providers: ReadonlyArray<ServerProvider>): ModelSelection | null {
  const codex = providers.find(
    (provider) =>
      provider.driver === CODEX &&
      provider.enabled &&
      provider.installed &&
      (provider.availability ?? "available") === "available" &&
      provider.status !== "error" &&
      provider.status !== "disabled",
  );
  if (!codex) return null;
  const preferred = DEFAULT_MODEL_BY_PROVIDER[CODEX];
  const model =
    codex.models.find((candidate) => candidate.slug === preferred)?.slug ??
    codex.models.find((candidate) => candidate.isDefault)?.slug ??
    codex.models[0]?.slug;
  return model ? { instanceId: codex.instanceId, model } : null;
}

type ReviewSource = Pick<
  EnvironmentThreadShell,
  "environmentId" | "projectId" | "branch" | "worktreePath"
>;

/**
 * Review a thread's work in a fresh Codex session: a new draft in the same
 * worktree (or folder session) that invokes the built-in review skill and
 * names the branch's base.
 */
export function useStartReview() {
  const handleNewThread = useNewThreadHandler();
  const serverConfigs = useServerConfigs();
  const environments = useEnvironmentFolders();

  return useCallback(
    async (thread: ReviewSource) => {
      const environment = environments.find(
        (entry) => entry.environmentId === thread.environmentId,
      );
      const providers = serverConfigs.get(thread.environmentId)?.providers ?? [];
      const hasReviewSkill = providers.some((provider) =>
        provider.skills.some((skill) => skill.name === REVIEW_SKILL),
      );
      if (!environment || !hasReviewSkill) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Reviews need an updated server",
            description: `This environment does not provide the ${REVIEW_SKILL} skill yet.`,
          }),
        );
        return;
      }
      const created = await handleNewThread(
        scopeProjectRef(thread.environmentId, thread.projectId),
        {
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          envMode: thread.worktreePath ? "worktree" : "local",
          startFromOrigin: false,
        },
      );
      if (!created) return;

      const store = useComposerDraftStore.getState();
      const reviewModel = pickReviewModel(providers);
      if (reviewModel) {
        store.setModelSelection(created.draftId, reviewModel, {
          explicit: true,
          replaceOptions: true,
        });
      } else {
        toastManager.add({
          type: "info",
          title: "Codex is not available here",
          description: "The review draft keeps the current provider; pick another before sending.",
        });
      }

      const match = findFolderForThread(environment.folders, thread);
      const scope =
        match === null
          ? "Review the changes on this branch against its base branch"
          : match.member === null
            ? "Review the changes in each repository of this folder against its base branch (folder.json lists them)"
            : `Review the changes on this branch against origin/${match.member.baseBranch}`;
      const request = `$${REVIEW_SKILL} ${scope}.`;
      const existing = store.getComposerDraft(created.draftId)?.prompt.trim() ?? "";
      store.setPrompt(created.draftId, existing ? `${request}\n\n${existing}` : request);
    },
    [environments, handleNewThread, serverConfigs],
  );
}
