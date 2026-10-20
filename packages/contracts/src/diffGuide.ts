import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PullRequestRef } from "./pullRequest.ts";

/**
 * A diff guide, like Linear's: the change split into a few sections in reading order, each with a
 * short explanation and the files it owns. Toggled on in a diff view, the files are shown grouped
 * and ordered by section. Written in one shot by a fast hosted model from an extended diff, so it
 * is cheap enough to generate automatically whenever a diff is opened.
 *
 * Unlike `PullRequestReviewGuide` (an agent-written tour stored per pull request), a diff guide is
 * a cache entry keyed by the diff itself, so it works for any diff and is never stale.
 */
export const DiffGuideSection = Schema.Struct({
  title: TrimmedNonEmptyString,
  /** Markdown, a few sentences. */
  body: Schema.String,
  /** Repo-relative paths, each listed by exactly one section. */
  files: Schema.Array(TrimmedNonEmptyString),
});
export type DiffGuideSection = typeof DiffGuideSection.Type;

export const DiffGuide = Schema.Struct({
  summary: Schema.String,
  sections: Schema.Array(DiffGuideSection),
  model: TrimmedNonEmptyString,
  /** The inference provider that answered, when the router reports it. */
  provider: Schema.NullOr(TrimmedNonEmptyString),
  generatedAt: IsoDateTime,
  durationMs: NonNegativeInt,
  /** Lines of context around each hunk in the diff the guide was written from. */
  contextLines: NonNegativeInt,
});
export type DiffGuide = typeof DiffGuide.Type;

/** The diffs a guide can be written for, mirroring the diff views that show one. */
export const DiffGuideTarget = Schema.Union([
  Schema.TaggedStruct("PullRequest", {
    reference: PullRequestRef,
    /** A single commit's diff instead of the whole change. */
    commitOid: Schema.NullOr(TrimmedNonEmptyString),
  }),
  Schema.TaggedStruct("Checkpoint", {
    threadId: ThreadId,
    fromTurnCount: NonNegativeInt,
    toTurnCount: NonNegativeInt,
  }),
  Schema.TaggedStruct("Review", {
    cwd: TrimmedNonEmptyString,
    sourceKind: Schema.Literals(["working-tree", "branch-range"]),
    baseRef: Schema.NullOr(TrimmedNonEmptyString),
  }),
]);
export type DiffGuideTarget = typeof DiffGuideTarget.Type;

export const DiffGuideGenerateInput = Schema.Struct({
  target: DiffGuideTarget,
  /** Skip the cache and write a new guide. */
  regenerate: Schema.optionalKey(Schema.Boolean),
});
export type DiffGuideGenerateInput = typeof DiffGuideGenerateInput.Type;

export const DiffGuideGenerateResult = Schema.Struct({
  /** Null when the diff is empty. */
  guide: Schema.NullOr(DiffGuide),
  cached: Schema.Boolean,
});
export type DiffGuideGenerateResult = typeof DiffGuideGenerateResult.Type;

export const DiffGuideStatus = Schema.Struct({
  /** Whether an OpenRouter API key is available to the server. */
  configured: Schema.Boolean,
  model: TrimmedNonEmptyString,
});
export type DiffGuideStatus = typeof DiffGuideStatus.Type;

export const DiffGuideSetApiKeyInput = Schema.Struct({
  /** Null removes the stored key. */
  apiKey: Schema.NullOr(TrimmedNonEmptyString),
});
export type DiffGuideSetApiKeyInput = typeof DiffGuideSetApiKeyInput.Type;

export class DiffGuideError extends Schema.TaggedError<DiffGuideError>()("DiffGuideError", {
  reason: Schema.Literals(["not-configured", "diff-unavailable", "model-failed"]),
  detail: TrimmedNonEmptyString,
}) {
  override get message(): string {
    return this.detail;
  }
}
