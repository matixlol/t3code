import { createSpriteEnvironmentAtoms } from "@t3tools/client-runtime/state/sprites";

import { connectionAtomRuntime } from "../connection/runtime";

export const spriteEnvironment = createSpriteEnvironmentAtoms(connectionAtomRuntime);
