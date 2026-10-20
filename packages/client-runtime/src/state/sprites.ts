import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createSpriteEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** Mode's sprites as Fly lists them, which never wakes one. */
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:sprites:list",
      tag: WS_METHODS.spritesList,
      staleTimeMs: 15_000,
    }),
    action: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sprites:action",
      tag: WS_METHODS.spritesAction,
    }),
    /** Asked of a sprite's own environment: what its compute has cost. */
    usage: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:sprites:usage",
      tag: WS_METHODS.spriteUsage,
      staleTimeMs: 60_000,
    }),
  };
}
