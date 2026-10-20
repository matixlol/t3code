import { DiffGuideError, type DiffGuideTarget, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useCallback, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { diffGuideEnvironment } from "~/state/diffGuide";
import { useEnvironmentQuery } from "~/state/query";

const DIFF_GUIDE_VIEW_STORAGE_KEY = "mode:diff-guide:view";
const DiffGuideView = Schema.Literals(["diff", "guide"]);

/** Whether the thread diff panel shows the plain diff or the guided one, kept per device. */
export function useDiffGuideView() {
  return useLocalStorage<"diff" | "guide", "diff" | "guide">(
    DIFF_GUIDE_VIEW_STORAGE_KEY,
    "diff",
    DiffGuideView,
  );
}

const isDiffGuideError = Schema.is(DiffGuideError);

/**
 * The guide for one diff, written automatically while the guide is open. The server caches by the
 * diff itself, so asking again for an unchanged diff never spends a model request.
 */
export function useDiffGuide({
  environmentId,
  target,
  open,
}: {
  environmentId: EnvironmentId | null;
  /** Null while the view has no diff to describe. */
  target: DiffGuideTarget | null;
  open: boolean;
}) {
  // Held per target: a new diff starts from the cached guide, not from a forced rewrite.
  const [regenerateFor, setRegenerateFor] = useState<string | null>(null);
  const targetKey = target === null ? null : JSON.stringify(target);
  const regenerate = regenerateFor !== null && regenerateFor === targetKey;
  // The family keys atoms by the input's JSON, so a target rebuilt every render is the same atom.
  const atom =
    open && environmentId !== null && target !== null
      ? diffGuideEnvironment.guide({
          environmentId,
          input: regenerate ? { target, regenerate: true } : { target },
        })
      : null;
  const query = useEnvironmentQuery(atom);
  const failure = isDiffGuideError(query.failure) ? query.failure : null;
  const requestRegenerate = useCallback(() => {
    if (targetKey === null) return;
    if (regenerate) query.refresh();
    else setRegenerateFor(targetKey);
  }, [query, regenerate, targetKey]);
  return {
    guide: query.data?.guide ?? null,
    cached: query.data?.cached ?? false,
    isPending: query.isPending,
    error: query.error,
    notConfigured: failure?.reason === "not-configured",
    retry: query.refresh,
    regenerate: requestRegenerate,
  };
}

export type DiffGuideState = ReturnType<typeof useDiffGuide>;
