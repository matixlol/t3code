import type { ScopedThreadRef, ThreadLinearIssue } from "@t3tools/contracts";
import { useEffect } from "react";

import { useThreadLinearIssues } from "~/state/linearIssues";

const PROMPT_CHARS = 400;

export interface ThreadWindowTitleInput {
  readonly linearIssues: ReadonlyArray<ThreadLinearIssue>;
  readonly threadTitle: string;
  readonly branch: string | null;
  readonly projectName: string | null;
  readonly worktreePath: string | null;
  readonly lastPrompt: string | null;
}

/**
 * The window title for a thread, most telling first: time trackers such as Timing read only the
 * window title, and some cut it short. The window hides its title bar, so nobody else sees it.
 */
export function threadWindowTitle(input: ThreadWindowTitleInput): string {
  const singleLine = (value: string) => value.replaceAll(/\s+/g, " ").trim();
  const prompt = input.lastPrompt === null ? "" : singleLine(input.lastPrompt);
  return (
    [
      ...input.linearIssues.map((issue) => `${issue.identifier} ${singleLine(issue.title)}`),
      singleLine(input.threadTitle),
      input.branch === null ? null : `branch ${input.branch}`,
      input.projectName === null ? null : `project ${input.projectName}`,
      input.worktreePath === null ? null : `worktree ${input.worktreePath}`,
      prompt === ""
        ? null
        : `prompt: ${prompt.length > PROMPT_CHARS ? `${prompt.slice(0, PROMPT_CHARS)}…` : prompt}`,
    ]
      .filter((part) => part !== null && part !== "")
      // oxlint-disable-next-line t3code/no-em-dash-copy -- a window title separator, not prose; time trackers match on it.
      .join(" — ")
  );
}

/** Titles the window after the thread on screen, and gives the app's title back on leaving it. */
export function useThreadWindowTitle(
  threadRef: ScopedThreadRef | null,
  input: Omit<ThreadWindowTitleInput, "linearIssues"> | null,
) {
  const linearIssues = useThreadLinearIssues(threadRef);
  const title =
    threadRef === null || input === null ? null : threadWindowTitle({ ...input, linearIssues });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document.title is external state, restored on unmount.
  useEffect(() => {
    if (title === null) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
