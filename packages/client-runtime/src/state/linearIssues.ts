import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createLinearIssuesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** A thread's linked Linear issues, kept current while watched. */
    threadIssues: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:linear-issues:thread",
      tag: WS_METHODS.linearIssuesSubscribe,
    }),
    unlink: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear-issues:unlink",
      tag: WS_METHODS.linearIssuesUnlink,
    }),
  };
}
