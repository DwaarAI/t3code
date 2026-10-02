import { createGitHubActionsEnvironmentAtoms } from "@t3tools/client-runtime/state/githubActions";

import { connectionAtomRuntime } from "../connection/runtime";

export const githubActionsEnvironment = createGitHubActionsEnvironmentAtoms(connectionAtomRuntime);
