import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Mode's Fly.io sprites: sandboxes that each run Mode's server behind a public URL. Mode keeps no
 * list of them. It reads them from the `sprite` CLI's own login on the machine running the server,
 * so a sprite created or destroyed anywhere shows up or disappears here.
 */

/** Every sprite Mode creates carries this prefix, which is how it finds them without waking any. */
export const MODE_SPRITE_PREFIX = "mode-";

export const ModeSprite = Schema.Struct({
  /** The full sprite name, prefix included. */
  name: TrimmedNonEmptyString,
  /** Fly's own state: running, warm (paused, wakes in under a second) or cold. */
  status: Schema.String,
  url: Schema.String,
  /** Whether the URL answers without Fly credentials, which Mode's clients need. */
  public: Schema.Boolean,
});
export type ModeSprite = typeof ModeSprite.Type;

export const SpritesListResult = Schema.Struct({
  /** False when the `sprite` CLI is missing or logged out here; `reason` says which. */
  available: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
  sprites: Schema.Array(ModeSprite),
});
export type SpritesListResult = typeof SpritesListResult.Type;

export const SpriteCreateInput = Schema.Struct({
  /** The part after the prefix: lowercase letters, digits and dashes. */
  name: TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/)),
});
export type SpriteCreateInput = typeof SpriteCreateInput.Type;

/**
 * One call for everything done to a sprite, which keeps the RPC group under the size where its
 * types stop inferring. `create` and `pair` answer with a pairing; `update` and `destroy` do not.
 */
export const SpriteActionInput = Schema.Union([
  Schema.TaggedStruct("create", { name: SpriteCreateInput.fields.name }),
  Schema.TaggedStruct("pair", { name: TrimmedNonEmptyString }),
  Schema.TaggedStruct("update", { name: TrimmedNonEmptyString }),
  Schema.TaggedStruct("destroy", { name: TrimmedNonEmptyString }),
]);
export type SpriteActionInput = typeof SpriteActionInput.Type;

/** A one-time credential for pairing a client with a sprite's server. */
export const SpritePairing = Schema.Struct({
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  credential: TrimmedNonEmptyString,
});
export type SpritePairing = typeof SpritePairing.Type;

export const SpriteActionResult = Schema.Struct({ pairing: Schema.NullOr(SpritePairing) });
export type SpriteActionResult = typeof SpriteActionResult.Type;

export const SpriteUsageWindow = Schema.Struct({
  days: Schema.Int,
  cpuHours: Schema.Number,
  memoryGbHours: Schema.Number,
  /** At Fly's published sprite rates; storage is not included. */
  usd: Schema.Number,
});
export type SpriteUsageWindow = typeof SpriteUsageWindow.Type;

/** What this server has measured of its own sprite's compute, answered by the sprite itself. */
export const SpriteUsage = Schema.Struct({
  /** False when this server is not running on a sprite. */
  available: Schema.Boolean,
  /** When measuring began, which bounds how far back the windows can see. */
  since: Schema.NullOr(IsoDateTime),
  windows: Schema.Array(SpriteUsageWindow),
});
export type SpriteUsage = typeof SpriteUsage.Type;

export class SpriteError extends Schema.TaggedError<SpriteError>()("SpriteError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
