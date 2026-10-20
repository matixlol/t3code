import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { createLinearIssuesEnvironmentAtoms } from "@t3tools/client-runtime/state/linearIssues";
import type { ScopedThreadRef, ThreadLinearIssue } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const linearIssuesEnvironment = createLinearIssuesEnvironmentAtoms(connectionAtomRuntime);

const EMPTY: ReadonlyArray<ThreadLinearIssue> = [];

const threadLinearIssuesAtom = Atom.family((key: string) =>
  Atom.make((get): ReadonlyArray<ThreadLinearIssue> => {
    const ref = parseScopedThreadKey(key);
    if (ref === null) return EMPTY;
    const result = get(
      linearIssuesEnvironment.threadIssues({
        environmentId: ref.environmentId,
        input: { threadId: ref.threadId },
      }),
    );
    // A server without Linear links (T3 Code itself) fails the subscription, which is none.
    return Option.getOrElse(AsyncResult.value(result), () => EMPTY);
  }).pipe(Atom.withLabel(`web-linear-issues:${key}`)),
);

/** The Linear issues agents linked to a thread; empty until the server answers. */
export function useThreadLinearIssues(
  threadRef: ScopedThreadRef | null,
): ReadonlyArray<ThreadLinearIssue> {
  // An empty key parses to no thread, which is no issues.
  return useAtomValue(threadLinearIssuesAtom(threadRef === null ? "" : scopedThreadKey(threadRef)));
}
