import type { DiffGuideSection, EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  FileDiffIcon,
  KeyRoundIcon,
  RotateCwIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { diffGuideEnvironment } from "~/state/diffGuide";
import { useAtomCommand } from "~/state/use-atom-command";

import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { DiffGuideState } from "./useDiffGuide";

/**
 * The top of a guided diff: what the change does, or why there is no guide yet. Rendered as the
 * diff viewer's own header so it scrolls with the files.
 */
export function DiffGuideSummary({
  state,
  environmentId,
  cwd,
}: {
  state: DiffGuideState;
  environmentId: EnvironmentId;
  cwd: string;
}) {
  const { guide } = state;
  return (
    <div className="px-4 py-3 font-sans text-xs">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <SparklesIcon className="size-3.5" />
        <span className="font-medium text-foreground">Guide</span>
        <span className="min-w-0 flex-1 truncate">
          {guide === null
            ? state.isPending && !state.notConfigured
              ? "Writing…"
              : ""
            : `${guide.sections.length} ${guide.sections.length === 1 ? "section" : "sections"} · ${
                state.cached
                  ? "cached"
                  : `${(guide.durationMs / 1000).toFixed(1)}s${guide.provider ? ` · ${guide.provider}` : ""}`
              }`}
        </span>
        {guide !== null || state.error !== null ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Write the guide again"
                  disabled={state.isPending}
                  onClick={state.regenerate}
                />
              }
            >
              <RotateCwIcon className={cn("size-3", state.isPending && "animate-spin")} />
            </TooltipTrigger>
            <TooltipPopup side="top">Write the guide again</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {state.notConfigured ? (
        <ApiKeyForm environmentId={environmentId} onSaved={state.retry} />
      ) : guide === null && state.isPending ? (
        <div className="space-y-1.5" aria-label="Writing the guide">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ) : guide === null && state.error !== null ? (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-muted-foreground">{state.error}</p>
          <Button size="xs" variant="outline" onClick={state.retry}>
            Try again
          </Button>
        </div>
      ) : guide?.summary ? (
        <PullRequestMarkdown
          text={guide.summary}
          cwd={cwd}
          environmentId={environmentId}
          className="text-foreground/90 [&_.chat-markdown]:text-inherit"
        />
      ) : null}
    </div>
  );
}

/** Which of a section's files the reader has ticked off, for surfaces that remember it. */
export interface DiffGuideSectionReview {
  readonly isViewed: (path: string) => boolean;
  /** Pushed to since it was ticked off, which no longer counts as reviewed. */
  readonly isStale: (path: string) => boolean;
  readonly setSectionViewed: (viewed: boolean) => void;
}

/** Scrolls to the guide section before or after the one holding `from`. */
function goToSiblingSection(from: HTMLElement, direction: -1 | 1) {
  let sibling: Element | null = from.closest("section");
  do {
    sibling =
      direction === 1
        ? (sibling?.nextElementSibling ?? null)
        : (sibling?.previousElementSibling ?? null);
  } while (sibling !== null && sibling.tagName !== "SECTION");
  sibling?.scrollIntoView({ block: "start", behavior: "smooth" });
}

const padSectionNumber = (value: number) => String(value).padStart(2, "0");

/**
 * A section's title, explanation and files, laid out like Linear's guide: a "01 / 04" counter that
 * turns into previous and next arrows on hover (moving without marking anything), and a Reviewed
 * box that ticks off every file in the section at once. Files the guide does not cover get a group
 * of their own.
 */
export function DiffGuideSectionText({
  number,
  total,
  section,
  paths,
  environmentId,
  cwd,
  onSelectFile,
  review,
}: {
  number: number | null;
  /** How many sections the guide has, for the counter. */
  total: number;
  section: DiffGuideSection | null;
  paths: ReadonlyArray<string>;
  environmentId: EnvironmentId;
  cwd: string;
  onSelectFile: (path: string) => void;
  review?: DiffGuideSectionReview | undefined;
}) {
  const reviewedCount =
    review === undefined
      ? 0
      : paths.filter((path) => review.isViewed(path) && !review.isStale(path)).length;
  const allReviewed = paths.length > 0 && reviewedCount === paths.length;
  return (
    <div className="font-sans text-xs" aria-label={section?.title ?? "Other changes"}>
      <h3 className="text-base font-semibold leading-snug">{section?.title ?? "Other changes"}</h3>
      <div className="mt-1 mb-3 flex h-6 items-center gap-2 text-muted-foreground">
        <span className="group/nav relative flex h-6 min-w-12 items-center">
          {number !== null ? (
            <span className="tabular-nums group-hover/nav:invisible group-focus-within/nav:invisible">
              <span className="text-foreground">{padSectionNumber(number)}</span> /{" "}
              {padSectionNumber(total)}
            </span>
          ) : null}
          <span
            className={cn(
              "absolute inset-y-0 left-0 flex items-center gap-0.5",
              number !== null && "invisible group-hover/nav:visible group-focus-within/nav:visible",
            )}
          >
            <Button
              size="icon-micro"
              variant="ghost"
              aria-label="Previous section"
              onClick={(event) => goToSiblingSection(event.currentTarget, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              size="icon-micro"
              variant="ghost"
              aria-label="Next section"
              onClick={(event) => goToSiblingSection(event.currentTarget, 1)}
            >
              <ArrowDownIcon />
            </Button>
          </span>
        </span>
        {review !== undefined && paths.length > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <label className="flex h-6 cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 hover:bg-accent hover:text-foreground" />
              }
            >
              <Checkbox
                aria-label="Mark section as reviewed"
                checked={allReviewed}
                indeterminate={reviewedCount > 0 && !allReviewed}
                onCheckedChange={() => review.setSectionViewed(!allReviewed)}
              />
              Reviewed
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {allReviewed ? "Mark section as not reviewed" : "Mark section as reviewed"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {section === null ? (
        <p className="text-muted-foreground">Files the guide does not cover.</p>
      ) : section.body ? (
        <PullRequestMarkdown
          text={section.body}
          cwd={cwd}
          environmentId={environmentId}
          className="text-muted-foreground [&_.chat-markdown]:text-inherit"
        />
      ) : null}
      <ul className="mt-3 space-y-1">
        {paths.map((path) => {
          const stale = review?.isStale(path) === true;
          const viewed = !stale && review?.isViewed(path) === true;
          return (
            <li key={path}>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-left text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => onSelectFile(path)}
              >
                <FileDiffIcon className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{path}</span>
                {viewed ? (
                  <CheckIcon aria-label="Reviewed" className="size-3 shrink-0 text-primary" />
                ) : stale ? (
                  <span
                    aria-label="Changed since reviewed"
                    className="size-1.5 shrink-0 rounded-full bg-warning"
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The guide's sections and their files beside the diff, for jumping around. */
export function DiffGuideOutline({
  state,
  onSelectFile,
}: {
  state: DiffGuideState;
  onSelectFile: (path: string) => void;
}) {
  const { guide } = state;
  return (
    <nav aria-label="Guide sections" className="flex min-h-0 w-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs font-medium">
        Sections
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-xs">
        {guide === null ? (
          <div className="space-y-2 px-1">
            {state.isPending
              ? [0, 1, 2].map((index) => <Skeleton key={index} className="h-3" />)
              : null}
          </div>
        ) : (
          <ol className="space-y-3">
            {guide.sections.map((section, index) => (
              <li key={`${section.title}:${section.files[0] ?? ""}`}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left font-medium hover:bg-accent"
                  onClick={() => {
                    const first = section.files[0];
                    if (first !== undefined) onSelectFile(first);
                  }}
                >
                  <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0">{section.title}</span>
                </button>
                <ul className="mt-0.5 pl-6">
                  {section.files.map((path) => (
                    <li key={path}>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={() => onSelectFile(path)}
                            />
                          }
                        >
                          <FileDiffIcon className="size-3 shrink-0" />
                          <span className="truncate">{path.split("/").at(-1)}</span>
                        </TooltipTrigger>
                        <TooltipPopup side="left">{path}</TooltipPopup>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </nav>
  );
}

/** Switches a diff panel between the plain diff and the guided one. */
export function DiffGuideViewSwitch({
  view,
  onViewChange,
}: {
  view: "diff" | "guide";
  onViewChange: (view: "diff" | "guide") => void;
}) {
  return (
    <ToggleGroup
      aria-label="Diff view"
      className="shrink-0"
      variant="segmented"
      value={[view]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "diff" || next === "guide") onViewChange(next);
      }}
    >
      <Toggle aria-label="Plain diff" value="diff">
        <FileDiffIcon className="size-3.5" />
      </Toggle>
      <Toggle aria-label="Guided diff" value="guide">
        <SparklesIcon className="size-3.5" />
      </Toggle>
    </ToggleGroup>
  );
}

function ApiKeyForm({
  environmentId,
  onSaved,
}: {
  environmentId: EnvironmentId;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const setKey = useAtomCommand(diffGuideEnvironment.setApiKey);
  const canSetKey = useAtomValue(diffGuideEnvironment.setApiKey.permissionAtom(environmentId));
  if (!canSetKey) {
    return (
      <p className="text-muted-foreground">
        Guides need an OpenRouter API key on this environment. Ask its owner to add one.
      </p>
    );
  }
  const save = async () => {
    const trimmed = apiKey.trim();
    if (trimmed === "" || saving) return;
    setSaving(true);
    const result = await setKey({ environmentId, input: { apiKey: trimmed } });
    setSaving(false);
    if (result._tag === "Success") {
      setApiKey("");
      onSaved();
    }
  };
  return (
    <form
      className="flex max-w-md flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <KeyRoundIcon className="size-3.5" />
        OpenRouter API key
      </p>
      <p className="text-muted-foreground">
        Guides are written by DeepSeek Flash through zero-data-retention providers on OpenRouter,
        usually in a few seconds for a fraction of a cent. The key is stored on this
        environment&rsquo;s server.
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          size="sm"
          autoComplete="off"
          placeholder="sk-or-..."
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={saving || apiKey.trim() === ""}>
          Save
        </Button>
      </div>
    </form>
  );
}
