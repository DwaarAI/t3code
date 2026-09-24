import { createProviderSessionRefAtoms } from "@t3tools/client-runtime/state/providerSessionRef";

import { connectionAtomRuntime } from "../connection/runtime";

export const providerSessionRef = createProviderSessionRefAtoms(connectionAtomRuntime);
