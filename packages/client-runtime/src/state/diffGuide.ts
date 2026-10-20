import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createDiffGuideEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // The server caches guides by the exact diff, so re-reading is cheap: it re-reads the diff
    // and only asks the model again when the diff changed. A working tree changes under the
    // reader, so a guide is not held for long.
    guide: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:diff-guide:guide",
      tag: WS_METHODS.diffGuideGenerate,
      staleTimeMs: 15_000,
    }),
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:diff-guide:status",
      tag: WS_METHODS.diffGuideStatus,
      staleTimeMs: 60_000,
    }),
    setApiKey: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:diff-guide:set-api-key",
      tag: WS_METHODS.diffGuideSetApiKey,
    }),
  };
}
