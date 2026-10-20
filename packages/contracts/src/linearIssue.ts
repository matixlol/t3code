import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A Linear issue an agent linked to a thread. Mode never talks to Linear: the agent already knows
 * the issue (from its own Linear tools or the prompt) and registers it with the link_linear_issue
 * MCP tool, so this is only what the agent said, not a synced copy.
 */
export const ThreadLinearIssue = Schema.Struct({
  /** The issue's key, for example ENG-123. */
  identifier: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  linkedAt: IsoDateTime,
});
export type ThreadLinearIssue = typeof ThreadLinearIssue.Type;

export const ThreadLinearIssuesInput = Schema.Struct({ threadId: ThreadId });
export type ThreadLinearIssuesInput = typeof ThreadLinearIssuesInput.Type;

export const ThreadLinearIssueUnlinkInput = Schema.Struct({
  threadId: ThreadId,
  identifier: TrimmedNonEmptyString,
});
export type ThreadLinearIssueUnlinkInput = typeof ThreadLinearIssueUnlinkInput.Type;

export class ThreadLinearIssueError extends Schema.TaggedError<ThreadLinearIssueError>()(
  "ThreadLinearIssueError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const LINEAR_ISSUE_PATH = /^\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/|$)/;

/**
 * The identifier in a Linear issue URL such as https://linear.app/acme/issue/ENG-123/some-title,
 * upper-cased, or null when the URL is not one.
 */
export function linearIssueIdentifierOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "linear.app") return null;
  const match = LINEAR_ISSUE_PATH.exec(parsed.pathname);
  return match?.[1]?.toUpperCase() ?? null;
}
