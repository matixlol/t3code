import { formatDiffCount } from "@t3tools/client-runtime/diff-count";
import type { ChangedFileKind } from "@t3tools/shared/changedFileKind";
import type { ReactElement } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const KIND_LABELS = {
  code: "Code",
  tests: "Tests",
  mocks: "Mocks",
  generated: "Generated",
  docs: "Docs",
} satisfies Record<ChangedFileKind, string>;

type DiffTotals = { additions: number; deletions: number };
export type ChangeBreakdown = Record<ChangedFileKind, DiffTotals>;

/** A diff stat that shows its split by kind on hover. */
export function ChangeBreakdownTooltip({
  breakdown,
  children,
}: {
  breakdown: ChangeBreakdown;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{children}</span>} />
      <TooltipPopup side="bottom">
        <ChangeBreakdownGrid breakdown={breakdown} total={totalOf(breakdown)} />
      </TooltipPopup>
    </Tooltip>
  );
}

function totalOf(breakdown: ChangeBreakdown): DiffTotals {
  return Object.values(breakdown).reduce(
    (total, stat) => ({
      additions: total.additions + stat.additions,
      deletions: total.deletions + stat.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

export function ChangeBreakdownGrid({
  breakdown,
  total,
}: {
  breakdown: ChangeBreakdown;
  total?: DiffTotals;
}) {
  return (
    <div className="grid grid-cols-[auto_auto_auto] justify-start gap-x-4 gap-y-1 py-0.5 font-mono tabular-nums">
      {(Object.keys(KIND_LABELS) as Array<ChangedFileKind>).map((kind) => {
        const { additions, deletions } = breakdown[kind];
        return additions === 0 && deletions === 0 ? null : (
          <BreakdownRow
            key={kind}
            label={KIND_LABELS[kind]}
            additions={additions}
            deletions={deletions}
          />
        );
      })}
      {total ? (
        <>
          <div className="col-span-3 border-t border-border" />
          <BreakdownRow label="Total" additions={total.additions} deletions={total.deletions} />
        </>
      ) : null}
    </div>
  );
}

function BreakdownRow({ label, additions, deletions }: DiffTotals & { label: string }) {
  return (
    <>
      <span className="font-sans">{label}</span>
      <span className="text-right text-diff-addition-foreground">
        +{formatDiffCount(additions)}
      </span>
      <span className="text-right text-diff-deletion">-{formatDiffCount(deletions)}</span>
    </>
  );
}
