import { createDiffGuideEnvironmentAtoms } from "@t3tools/client-runtime/state/diffGuide";

import { connectionAtomRuntime } from "../connection/runtime";

export const diffGuideEnvironment = createDiffGuideEnvironmentAtoms(connectionAtomRuntime);
