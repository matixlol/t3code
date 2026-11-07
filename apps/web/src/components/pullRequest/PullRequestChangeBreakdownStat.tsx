import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { authoredChangeStat } from "@t3tools/shared/changedFileKind";
import { useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { ChangeBreakdownGrid } from "../diffs/ChangeBreakdown";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestDiffStat } from "./pullRequestPresentation";

/**
 * The pull request's diff stat, with a hover split into code, tests, mocks, and generated files.
 * In lists the split is read on first pointer or focus intent, so rows nobody hovers cost the
 * host nothing, and the stat stays the total. A view of one pull request passes `eager`: the split
 * is ready before the hover, and the stat counts only the authored code and docs.
 */
export function PullRequestChangeBreakdownStat({
  environmentId,
  reference,
  additions,
  deletions,
  className,
  eager = false,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  additions: number;
  deletions: number;
  className: string;
  eager?: boolean;
}) {
  const [requested, setRequested] = useState(eager);
  const query = useEnvironmentQuery(
    requested ? pullRequestEnvironment.changeBreakdown({ environmentId, input: reference }) : null,
  );
  const breakdown = query.data;
  if (additions === 0 && deletions === 0) return null;
  const shown = eager && breakdown ? authoredChangeStat(breakdown) : { additions, deletions };
  return (
    <Tooltip>
      <TooltipTrigger
        onPointerEnter={() => setRequested(true)}
        onFocus={() => setRequested(true)}
        render={
          <span className="inline-flex">
            <PullRequestDiffStat
              additions={shown.additions}
              deletions={shown.deletions}
              className={className}
            />
          </span>
        }
      />
      {breakdown ? (
        <TooltipPopup side="bottom">
          <ChangeBreakdownGrid breakdown={breakdown} total={{ additions, deletions }} />
        </TooltipPopup>
      ) : query.isPending ? (
        <TooltipPopup side="bottom">Loading breakdown</TooltipPopup>
      ) : null}
    </Tooltip>
  );
}

/**
 * The split shown inline, for surfaces that already sit behind a hover, such as the thread
 * details card. It reads on mount, so it costs the host a request only once the card opens.
 */
export function PullRequestChangeBreakdownRows({
  environmentId,
  reference,
  className,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  className: string;
}) {
  const query = useEnvironmentQuery(
    pullRequestEnvironment.changeBreakdown({ environmentId, input: reference }),
  );
  if (!query.data) return null;
  return (
    <div className={className}>
      <ChangeBreakdownGrid breakdown={query.data} />
    </div>
  );
}
