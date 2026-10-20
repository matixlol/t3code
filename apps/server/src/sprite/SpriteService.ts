/**
 * Mode's sprites, driven through the `sprite` CLI and its own login on this machine. Nothing about
 * them is stored here: listing reads Fly's inventory (which never wakes a sprite), and everything
 * else runs commands against the sprite by name.
 *
 * @module sprite/SpriteService
 */
import {
  MODE_SPRITE_PREFIX,
  type ModeSprite,
  SpriteError,
  type SpritePairing,
  type SpritesListResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import { MODE_SPRITE_PAIR_SCRIPT, MODE_SPRITE_SETUP_SCRIPT } from "./spriteSetupScript.ts";

export class SpriteService extends Context.Service<
  SpriteService,
  {
    readonly list: Effect.Effect<SpritesListResult, SpriteError>;
    /** Creates `mode-<name>`, installs Mode's server and returns a credential to pair with it. */
    readonly create: (name: string) => Effect.Effect<SpritePairing, SpriteError>;
    readonly pair: (name: string) => Effect.Effect<SpritePairing, SpriteError>;
    readonly update: (name: string) => Effect.Effect<void, SpriteError>;
    readonly destroy: (name: string) => Effect.Effect<void, SpriteError>;
  }
>()("t3/sprite/SpriteService") {}

const SpriteListJson = Schema.Struct({
  sprites: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      url: Schema.String,
      url_settings: Schema.optional(Schema.Struct({ auth: Schema.optional(Schema.String) })),
    }),
  ),
});
const decodeSpriteList = Schema.decodeUnknownEffect(Schema.fromJsonString(SpriteListJson));

const PairingJson = Schema.Struct({ credential: Schema.String });
const decodePairing = Schema.decodeUnknownEffect(Schema.fromJsonString(PairingJson));

/** The CLI installs to ~/.local/bin, which a server launched by the desktop app may not have. */
const resolveSpriteBinary = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const candidates = [
    process.env.SPRITE_BIN,
    process.env.HOME ? path.join(process.env.HOME, ".local", "bin", "sprite") : undefined,
    ...(process.env.PATH ?? "").split(":").map((dir) => path.join(dir, "sprite")),
  ].filter((candidate): candidate is string => candidate !== undefined && candidate !== "");
  for (const candidate of candidates) {
    if (yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
      return candidate;
    }
  }
  return null;
});

function isModeSpriteName(name: string): boolean {
  return name.startsWith(MODE_SPRITE_PREFIX);
}

const make = Effect.gen(function* () {
  const processes = yield* ProcessRunner.ProcessRunner;
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const findBinary = resolveSpriteBinary.pipe(Effect.provide(services));

  const run = (args: ReadonlyArray<string>, timeout: Duration.Input = "60 seconds") =>
    Effect.gen(function* () {
      const binary = yield* findBinary;
      if (binary === null) {
        return yield* new SpriteError({
          detail: "The sprite CLI is not installed. Install it from sprites.dev.",
        });
      }
      const result = yield* processes
        .run({ command: binary, args, timeout, timeoutBehavior: "timedOutResult" })
        .pipe(Effect.mapError((cause) => new SpriteError({ detail: cause.message })));
      if (result.timedOut) {
        return yield* new SpriteError({ detail: `sprite ${args[0]} timed out.` });
      }
      if (result.code !== 0) {
        const detail = (result.stderr.trim() || result.stdout.trim())
          .split("\n")
          .slice(-3)
          .join("\n");
        return yield* new SpriteError({ detail: detail || `sprite ${args[0]} failed.` });
      }
      return result.stdout;
    });

  const requireModeSprite = (name: string) =>
    isModeSpriteName(name)
      ? Effect.succeed(name)
      : Effect.fail(new SpriteError({ detail: `${name} is not one of Mode's sprites.` }));

  const listSprites = run(["--json", "list", "--prefix", MODE_SPRITE_PREFIX]).pipe(
    Effect.flatMap((stdout) =>
      decodeSpriteList(stdout).pipe(
        Effect.mapError(() => new SpriteError({ detail: "Could not read the sprite list." })),
      ),
    ),
    Effect.map(({ sprites }) =>
      sprites
        .filter((sprite) => isModeSpriteName(sprite.name))
        .map((sprite): ModeSprite => ({
          name: sprite.name,
          status: sprite.status,
          url: sprite.url,
          public: sprite.url_settings?.auth === "public",
        })),
    ),
  );

  const exec = (name: string, script: string, timeout: Duration.Input) =>
    run(["-s", name, "exec", "--no-stdin", "--", "bash", "-lc", script], timeout);

  const setup = (name: string) => exec(name, MODE_SPRITE_SETUP_SCRIPT, "15 minutes");

  const pair = (name: string) =>
    Effect.gen(function* () {
      yield* requireModeSprite(name);
      const sprites = yield* listSprites;
      const sprite = sprites.find((candidate) => candidate.name === name);
      if (sprite === undefined) return yield* new SpriteError({ detail: `${name} was not found.` });
      const stdout = yield* exec(name, MODE_SPRITE_PAIR_SCRIPT, "2 minutes");
      // The login shell can print notices before the JSON.
      const json = stdout.slice(stdout.indexOf("{"));
      const { credential } = yield* decodePairing(json).pipe(
        Effect.mapError(
          () => new SpriteError({ detail: `${name} did not hand out a pairing credential.` }),
        ),
      );
      return { name, url: sprite.url, credential } satisfies SpritePairing;
    });

  return SpriteService.of({
    list: Effect.gen(function* () {
      if ((yield* findBinary) === null) {
        return {
          available: false,
          reason: "Install the sprite CLI from sprites.dev and run `sprite login`.",
          sprites: [],
        } satisfies SpritesListResult;
      }
      return yield* listSprites.pipe(
        Effect.map((sprites): SpritesListResult => ({ available: true, reason: null, sprites })),
        Effect.catch((error) =>
          Effect.succeed<SpritesListResult>({
            available: false,
            reason: `${error.detail} Run \`sprite login\`.`,
            sprites: [],
          }),
        ),
      );
    }),
    create: (shortName) =>
      Effect.gen(function* () {
        const name = `${MODE_SPRITE_PREFIX}${shortName}`;
        yield* run(["create", "--skip-console", "--label", "mode", name], "3 minutes");
        // Pairing protects the server; Mode's clients cannot present Fly credentials.
        yield* run(["-s", name, "url", "update", "--auth", "public"]);
        yield* setup(name);
        return yield* pair(name);
      }),
    pair,
    update: (name) => requireModeSprite(name).pipe(Effect.andThen(setup(name)), Effect.asVoid),
    destroy: (name) =>
      requireModeSprite(name).pipe(
        Effect.andThen(run(["destroy", "--force", name], "2 minutes")),
        Effect.asVoid,
      ),
  });
});

export const layer = Layer.effect(SpriteService, make).pipe(Layer.provide(ProcessRunner.layer));
