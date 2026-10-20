/**
 * The Linear issues an agent linked to a thread, shown where its pull requests are: a badge in the
 * composer toolbar and rows in the thread details panel. Mode never talks to Linear; these are
 * the identifiers, titles and URLs the agent registered with link_linear_issue.
 */
import type { ScopedThreadRef, ThreadLinearIssue } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import type { MouseEvent, ReactElement, SVGProps } from "react";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "~/lib/utils";
import { linearIssuesEnvironment, useThreadLinearIssues } from "~/state/linearIssues";
import { useAtomCommand } from "~/state/use-atom-command";

import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function LinearGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  );
}

function IssueList({ issues }: { issues: ReadonlyArray<ThreadLinearIssue> }) {
  return (
    <ul className="-mx-1 flex flex-col gap-1">
      {issues.map((issue) => (
        <li key={issue.identifier}>
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <LinearGlyph aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-mono tabular-nums">{issue.identifier}</span>
            <span className="min-w-0 truncate text-foreground/75">{issue.title}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * The toolbar badge: the first issue's identifier, opening it, with every linked issue in its
 * tooltip. Renders nothing until an agent links one.
 */
export function ThreadLinearIssuesBadge({
  threadRef,
  render,
}: {
  threadRef: ScopedThreadRef;
  render: ReactElement<{ render?: useRender.RenderProp }>;
}) {
  const issues = useThreadLinearIssues(threadRef);
  const first = issues[0];
  const control = useRender({
    render,
    props: {
      render: <a href={first?.url} target="_blank" rel="noopener noreferrer" />,
      "aria-label": first ? `${first.identifier}: ${first.title}` : undefined,
      onPointerDown: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
    },
  });
  if (first === undefined) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={control}>
        <span className="contents font-normal text-xs tabular-nums">
          <LinearGlyph aria-hidden className="size-3 shrink-0" />
          <span>
            {first.identifier}
            {issues.length > 1 ? ` +${issues.length - 1}` : ""}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipPopup
        side="top"
        sideOffset={0}
        variant="glass"
        className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] text-left whitespace-normal"
      >
        <IssueList issues={issues} />
      </TooltipPopup>
    </Tooltip>
  );
}

/** Thread details rows: each issue opens in Linear, and its unlink control removes the link. */
export function ThreadDetailsLinearIssueRows({ threadRef }: { threadRef: ScopedThreadRef }) {
  const issues = useThreadLinearIssues(threadRef);
  const unlink = useAtomCommand(linearIssuesEnvironment.unlink, { reportFailure: true });
  return issues.map((issue) => (
    <div key={issue.identifier} className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
      <ThreadDetailsControl
        variant="ghost"
        size="sm"
        part="primary"
        aria-label={`${issue.identifier}: ${issue.title}`}
        render={<a href={issue.url} target="_blank" rel="noopener noreferrer" />}
      >
        <LinearGlyph aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
          {issue.identifier}: {issue.title}
        </span>
      </ThreadDetailsControl>
      <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              type="button"
              variant="ghost"
              size="sm"
              part="secondary"
              aria-label={`Unlink ${issue.identifier}`}
              onClick={() =>
                void unlink({
                  environmentId: threadRef.environmentId,
                  input: { threadId: threadRef.threadId, identifier: issue.identifier },
                })
              }
            />
          }
        >
          <XIcon aria-hidden className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">Unlink from this thread</TooltipPopup>
      </Tooltip>
    </div>
  ));
}
