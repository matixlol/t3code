/**
 * Diff guides: a Linear-style reading guide for any diff the app shows (a pull request, a thread's
 * checkpoint range, or a working tree / branch review), written in one shot by a fast hosted model
 * through OpenRouter.
 *
 * The model reads an extended diff (more context than the views show) and returns sections in
 * reading order. Guides are cached by the exact diff, in memory and on disk under the caches
 * directory, so reopening a diff never spends a request and a changed diff always gets a new
 * guide. Nothing is stored in the database, so this module adds no migrations.
 *
 * @module diffGuide/DiffGuideService
 */
import {
  type DiffGuide,
  DiffGuideError,
  type DiffGuideGenerateInput,
  type DiffGuideGenerateResult,
  type DiffGuideStatus,
  type DiffGuideTarget,
  type PullRequestRef,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as ReviewService from "../review/ReviewService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { PATCH_RENDER_PREFIX_ARGS } from "../vcs/GitVcsDriverCore.ts";
import {
  buildDiffGuideUserMessage,
  DIFF_GUIDE_CONTEXT_STEPS,
  DIFF_GUIDE_MAX_DIFF_CHARS,
  DIFF_GUIDE_PROMPT_VERSION,
  DIFF_GUIDE_SYSTEM_PROMPT,
  type DiffGuideFilePatch,
  type DiffGuideRequestContext,
  fitDiffToBudget,
  normalizeDiffGuide,
  parseDiffGuideReply,
  splitDiffFiles,
} from "./diffGuideModel.ts";

/**
 * DeepSeek's newest flash model. Benchmarked on OpenRouter (Oct 2026) against every provider
 * serving it: Together was the only one under five seconds at every diff size (1.2-4.4s up to a
 * 42k-token diff); InferenceNet and Wafer are cheaper fallbacks a little slower on big diffs.
 * All three are zero-data-retention endpoints; DeepSeek's own API is not, so it is never used.
 */
export const DIFF_GUIDE_MODEL = "deepseek/deepseek-v4.1-flash-1017";
const DIFF_GUIDE_PROVIDER_ORDER = ["together", "inference-net", "wafer"];
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY_SECRET = "openrouter-api-key";
const MEMORY_CACHE_LIMIT = 200;
/** Local git work for a pull request's extended diff gives up after this and uses the host's. */
const LOCAL_PULL_REQUEST_DIFF_BUDGET = "8 seconds";
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,64}$/;

const OpenRouterReply = Schema.Struct({
  provider: Schema.optional(Schema.String),
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({ content: Schema.NullOr(Schema.String) }),
    }),
  ),
});

const CachedGuide = Schema.fromJsonString(
  Schema.Struct({
    summary: Schema.String,
    sections: Schema.Array(
      Schema.Struct({
        title: Schema.String,
        body: Schema.String,
        files: Schema.Array(Schema.String),
      }),
    ),
    model: Schema.String,
    provider: Schema.NullOr(Schema.String),
    generatedAt: Schema.String,
    durationMs: Schema.Number,
    contextLines: Schema.Number,
  }),
);

const decodeCachedGuide = Schema.decodeEffect(CachedGuide);

export class DiffGuideService extends Context.Service<
  DiffGuideService,
  {
    readonly status: Effect.Effect<DiffGuideStatus>;
    readonly setApiKey: (apiKey: string | null) => Effect.Effect<DiffGuideStatus, DiffGuideError>;
    readonly generate: (
      input: DiffGuideGenerateInput,
    ) => Effect.Effect<DiffGuideGenerateResult, DiffGuideError>;
  }
>()("t3/diffGuide/DiffGuideService") {}

interface PreparedDiff {
  readonly files: ReadonlyArray<DiffGuideFilePatch>;
  readonly contextLines: number;
  readonly context: DiffGuideRequestContext;
}

const unavailable = (detail: string) => new DiffGuideError({ reason: "diff-unavailable", detail });

const errorDetail = (error: unknown, fallback: string): string => {
  if (typeof error === "object" && error !== null) {
    if ("detail" in error && typeof error.detail === "string" && error.detail.trim()) {
      return error.detail;
    }
    if ("message" in error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
};

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const checkpointDiffs = yield* CheckpointDiffQuery.CheckpointDiffQuery;
  const reviews = yield* ReviewService.ReviewService;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const envApiKey = yield* Config.option(Config.Redacted("OPENROUTER_API_KEY")).pipe(
    Effect.orElseSucceed(() => Option.none()),
  );

  const cacheDir = path.join(config.providerStatusCacheDir, "diff-guides");
  const memoryCache = new Map<string, DiffGuide>();
  const inFlight = new Map<string, Deferred.Deferred<DiffGuide, DiffGuideError>>();
  let refCounter = 0;

  const readApiKey = secrets.get(API_KEY_SECRET).pipe(
    Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).trim())),
    Effect.map(Option.filter((key) => key.length > 0)),
    Effect.orElseSucceed(() => Option.none<string>()),
    Effect.map((stored) =>
      Option.orElse(stored, () => Option.map(envApiKey, (key) => Redacted.value(key).trim())),
    ),
    Effect.map(Option.filter((key) => key.length > 0)),
  );

  const status: DiffGuideService["Service"]["status"] = readApiKey.pipe(
    Effect.map((key) => ({ configured: Option.isSome(key), model: DIFF_GUIDE_MODEL })),
  );

  const setApiKey: DiffGuideService["Service"]["setApiKey"] = (apiKey) =>
    (apiKey === null
      ? secrets.remove(API_KEY_SECRET)
      : secrets.set(API_KEY_SECRET, new TextEncoder().encode(apiKey.trim()))
    ).pipe(
      Effect.mapError(
        () =>
          new DiffGuideError({
            reason: "not-configured",
            detail: "Could not save the OpenRouter API key.",
          }),
      ),
      Effect.andThen(status),
    );

  // ---------------------------------------------------------------------------
  // Reading the diff
  // ---------------------------------------------------------------------------

  /** Tries generous context first and steps down until the diff fits the model budget. */
  const withShrinkingContext = <E>(
    read: (contextLines: number) => Effect.Effect<string, E>,
  ): Effect.Effect<{ readonly diff: string; readonly contextLines: number }, E> =>
    Effect.gen(function* () {
      let last = { diff: "", contextLines: 3 };
      for (const contextLines of DIFF_GUIDE_CONTEXT_STEPS) {
        last = { diff: yield* read(contextLines), contextLines };
        if (last.diff.length <= DIFF_GUIDE_MAX_DIFF_CHARS) return last;
      }
      return last;
    });

  const checkpointDiff = (target: Extract<DiffGuideTarget, { _tag: "Checkpoint" }>) =>
    withShrinkingContext((contextLines) =>
      checkpointDiffs
        .getTurnDiff({
          threadId: target.threadId,
          fromTurnCount: target.fromTurnCount,
          toTurnCount: target.toTurnCount,
          // The view's own default; the model reads whitespace churn as noise anyway.
          ignoreWhitespace: true,
          contextLines,
        })
        .pipe(Effect.map((result) => result.diff)),
    ).pipe(
      Effect.map(({ diff, contextLines }) => ({
        files: splitDiffFiles(diff),
        contextLines,
        context: {},
      })),
      Effect.mapError((error) => unavailable(errorDetail(error, "Could not read the turn diff."))),
    );

  const reviewDiff = (target: Extract<DiffGuideTarget, { _tag: "Review" }>) =>
    withShrinkingContext((contextLines) =>
      reviews
        .getDiffPreview({
          cwd: target.cwd,
          ...(target.baseRef === null ? {} : { baseRef: target.baseRef }),
          contextLines,
        })
        .pipe(
          Effect.map(
            (result) =>
              result.sources.find((source) => source.kind === target.sourceKind)?.diff ?? "",
          ),
        ),
    ).pipe(
      Effect.map(({ diff, contextLines }) => ({
        files: splitDiffFiles(diff),
        contextLines,
        context: {},
      })),
      Effect.mapError((error) => unavailable(errorDetail(error, "Could not read the diff."))),
    );

  /** The host's own patch, every slice of it: the authority on which files the change touches. */
  const hostPullRequestDiff = (reference: PullRequestRef, commitOid: string | null) =>
    Effect.gen(function* () {
      const patches: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 50; page += 1) {
        const slice = yield* pullRequests.diff({
          ...reference,
          ...(cursor === undefined ? {} : { cursor }),
          ...(commitOid === null ? {} : { commit: commitOid }),
        });
        patches.push(slice.patch);
        if (slice.nextCursor === null) break;
        cursor = slice.nextCursor;
      }
      return patches.join("\n");
    });

  /**
   * The same change from the project's own checkout, with more context than a host hands out.
   * Fetches the head and base the way the review guide does, into refs of this request's own.
   */
  const localPullRequestDiff = Effect.fn("DiffGuideService.localPullRequestDiff")(function* (
    workspaceRoot: string,
    detail: { number: number; headSha?: string | undefined; baseBranch: string },
    commitOid: string | null,
  ) {
    const headSha = (commitOid ?? detail.headSha)?.toLowerCase();
    if (headSha === undefined || !COMMIT_HASH_PATTERN.test(headSha)) return null;
    if (detail.baseBranch.startsWith("+") || detail.baseBranch.includes(":")) return null;
    const remote = yield* git.resolvePrimaryRemoteName(workspaceRoot);
    const run = (args: ReadonlyArray<string>, options?: { maxOutputBytes?: number }) =>
      git.execute({
        operation: "DiffGuideService.localPullRequestDiff",
        cwd: workspaceRoot,
        args,
        timeoutMs: 60_000,
        ...options,
      });
    const hasCommit = (sha: string) =>
      run(["cat-file", "-e", `${sha}^{commit}`]).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    const id = `${(yield* Clock.currentTimeMillis).toString(36)}-${(refCounter += 1)}`;
    const headRef = `refs/mode/diff-guide/${id}/head`;
    const baseRef = `refs/mode/diff-guide/${id}/base`;
    const dropRefs = Effect.forEach([headRef, baseRef], (ref) =>
      run(["update-ref", "-d", ref]).pipe(Effect.ignore),
    );
    return yield* Effect.gen(function* () {
      if (!(yield* hasCommit(headSha))) {
        yield* run([
          "fetch",
          "--quiet",
          "--no-tags",
          remote,
          `+refs/pull/${detail.number}/head:${headRef}`,
        ]).pipe(Effect.ignore);
        if (!(yield* hasCommit(headSha))) return null;
      }
      const prefix = ["-c", "core.quotePath=false", "diff", ...PATCH_RENDER_PREFIX_ARGS];
      const flags = ["--find-renames", "--no-color", "--no-ext-diff", "--no-textconv"];
      let range: ReadonlyArray<string>;
      if (commitOid !== null) {
        range = [`${headSha}^!`];
      } else {
        yield* run(["check-ref-format", "--branch", detail.baseBranch]);
        yield* run([
          "fetch",
          "--quiet",
          "--no-tags",
          remote,
          `+refs/heads/${detail.baseBranch}:${baseRef}`,
        ]);
        const mergeBase = yield* run(["merge-base", baseRef, headSha]);
        range = [mergeBase.stdout.trim(), headSha];
      }
      return yield* withShrinkingContext((contextLines) =>
        run([...prefix, ...flags, `--unified=${contextLines}`, ...range], {
          maxOutputBytes: 64 * 1024 * 1024,
        }).pipe(Effect.map((result) => result.stdout)),
      );
    }).pipe(Effect.ensuring(dropRefs));
  });

  const pullRequestDiff = (target: Extract<DiffGuideTarget, { _tag: "PullRequest" }>) =>
    pullRequests
      .withRoutingCredential(
        target.reference,
        Effect.gen(function* () {
          const [detail, hostPatch, project] = yield* Effect.all(
            [
              pullRequests.detail(target.reference),
              hostPullRequestDiff(target.reference, target.commitOid),
              projects
                .getShell(target.reference.projectId)
                .pipe(Effect.orElseSucceed(() => Option.none())),
            ],
            { concurrency: "unbounded" },
          );
          const hostFiles = splitDiffFiles(hostPatch);
          const context = { title: detail.title, description: detail.body };
          const local = Option.isNone(project)
            ? null
            : yield* localPullRequestDiff(
                project.value.workspaceRoot,
                detail,
                target.commitOid,
              ).pipe(
                Effect.timeout(LOCAL_PULL_REQUEST_DIFF_BUDGET),
                Effect.catchCause((cause) =>
                  Effect.logDebug("Diff guide fell back to the host's diff", { cause }).pipe(
                    Effect.as(null),
                  ),
                ),
              );
          if (local !== null) {
            const localFiles = splitDiffFiles(local.diff);
            const hostPaths = new Set(hostFiles.map((file) => file.path));
            // Only trusted when it is the same change: a stale base would add other files.
            if (
              localFiles.length === hostFiles.length &&
              localFiles.every((file) => hostPaths.has(file.path))
            ) {
              return { files: localFiles, contextLines: local.contextLines, context };
            }
          }
          return { files: hostFiles, contextLines: 3, context };
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          unavailable(errorDetail(error, "Could not read the pull request's diff.")),
        ),
      );

  const prepare = (target: DiffGuideTarget): Effect.Effect<PreparedDiff, DiffGuideError> => {
    switch (target._tag) {
      case "Checkpoint":
        return checkpointDiff(target);
      case "Review":
        return reviewDiff(target);
      case "PullRequest":
        return pullRequestDiff(target);
    }
  };

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------

  const hashKey = (diff: string) =>
    crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(`${DIFF_GUIDE_PROMPT_VERSION}\0${DIFF_GUIDE_MODEL}\0${diff}`),
      )
      .pipe(
        Effect.map(Hex.encode),
        Effect.mapError(() => unavailable("Could not hash the diff.")),
      );

  const remember = (key: string, guide: DiffGuide) => {
    memoryCache.delete(key);
    memoryCache.set(key, guide);
    while (memoryCache.size > MEMORY_CACHE_LIMIT) {
      const oldest = memoryCache.keys().next().value;
      if (oldest === undefined) break;
      memoryCache.delete(oldest);
    }
  };

  const readCached = (key: string) =>
    Effect.gen(function* () {
      const inMemory = memoryCache.get(key);
      if (inMemory !== undefined) return Option.some(inMemory);
      const raw = yield* fileSystem.readFileString(path.join(cacheDir, `${key}.json`));
      const decoded = yield* decodeCachedGuide(raw);
      const guide = decoded as unknown as DiffGuide;
      remember(key, guide);
      return Option.some(guide);
    }).pipe(Effect.orElseSucceed(() => Option.none<DiffGuide>()));

  const writeCached = (key: string, guide: DiffGuide) => {
    remember(key, guide);
    return fileSystem
      .makeDirectory(cacheDir, { recursive: true })
      .pipe(
        Effect.andThen(
          fileSystem.writeFileString(path.join(cacheDir, `${key}.json`), JSON.stringify(guide)),
        ),
        Effect.ignore({ log: true }),
      );
  };

  // ---------------------------------------------------------------------------
  // Model
  // ---------------------------------------------------------------------------

  const callModel = Effect.fn("DiffGuideService.callModel")(function* (
    apiKey: string,
    prepared: PreparedDiff,
    diff: string,
  ) {
    const changedPaths = prepared.files.map((file) => file.path);
    const startedAt = yield* Clock.currentTimeMillis;
    const response = yield* httpClient
      .execute(
        HttpClientRequest.post(OPENROUTER_URL).pipe(
          HttpClientRequest.bearerToken(apiKey),
          HttpClientRequest.setHeaders({
            "HTTP-Referer": "https://github.com/matixlol/t3code",
            "X-Title": "Mode",
          }),
          HttpClientRequest.bodyJsonUnsafe({
            model: DIFF_GUIDE_MODEL,
            temperature: 0.2,
            max_tokens: 4_000,
            reasoning: { enabled: false },
            // Zero data retention only: diffs are private code, and OpenRouter refuses any
            // endpoint that retains prompts, fallbacks included.
            provider: { order: DIFF_GUIDE_PROVIDER_ORDER, allow_fallbacks: true, zdr: true },
            messages: [
              { role: "system", content: DIFF_GUIDE_SYSTEM_PROMPT },
              { role: "user", content: buildDiffGuideUserMessage(diff, prepared.context) },
            ],
          }),
        ),
      )
      .pipe(
        Effect.timeout("60 seconds"),
        Effect.mapError(
          (cause) =>
            new DiffGuideError({
              reason: "model-failed",
              detail: `Could not reach OpenRouter: ${errorDetail(cause, "request failed")}`,
            }),
        ),
      );
    if (response.status === 401 || response.status === 403) {
      return yield* new DiffGuideError({
        reason: "not-configured",
        detail: "OpenRouter rejected the API key. Set a new one.",
      });
    }
    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* new DiffGuideError({
        reason: "model-failed",
        detail: `OpenRouter answered ${response.status}: ${body.slice(0, 300) || "no detail"}`,
      });
    }
    const reply = yield* HttpClientResponse.schemaBodyJson(OpenRouterReply)(response).pipe(
      Effect.mapError(
        () =>
          new DiffGuideError({
            reason: "model-failed",
            detail: "OpenRouter's reply was not in the expected shape.",
          }),
      ),
    );
    const raw = parseDiffGuideReply(reply.choices[0]?.message.content ?? "");
    if (raw === null) {
      return yield* new DiffGuideError({
        reason: "model-failed",
        detail: "The model did not return a guide.",
      });
    }
    const finishedAt = yield* Clock.currentTimeMillis;
    const guide: DiffGuide = {
      ...normalizeDiffGuide(raw, changedPaths),
      model: DIFF_GUIDE_MODEL,
      provider: reply.provider?.trim() || null,
      generatedAt: DateTime.formatIso(DateTime.makeUnsafe(finishedAt)),
      durationMs: Math.max(0, finishedAt - startedAt),
      contextLines: prepared.contextLines,
    };
    return guide;
  });

  const generate: DiffGuideService["Service"]["generate"] = Effect.fn("DiffGuideService.generate")(
    function* (input) {
      const prepared = yield* prepare(input.target);
      if (prepared.files.length === 0) return { guide: null, cached: false };
      const { diff } = fitDiffToBudget(prepared.files, DIFF_GUIDE_MAX_DIFF_CHARS);
      const key = yield* hashKey(diff);
      if (input.regenerate !== true) {
        const cached = yield* readCached(key);
        if (Option.isSome(cached)) return { guide: cached.value, cached: true };
      }
      // Two views opening the same diff share one request.
      const running = inFlight.get(key);
      if (running !== undefined) {
        return { guide: yield* Deferred.await(running), cached: false };
      }
      const apiKey = yield* readApiKey;
      if (Option.isNone(apiKey)) {
        return yield* new DiffGuideError({
          reason: "not-configured",
          detail: "Add an OpenRouter API key to write diff guides.",
        });
      }
      const deferred = yield* Deferred.make<DiffGuide, DiffGuideError>();
      inFlight.set(key, deferred);
      const exit = yield* Effect.exit(
        callModel(apiKey.value, prepared, diff).pipe(
          Effect.tap((guide) => writeCached(key, guide)),
        ),
      );
      inFlight.delete(key);
      yield* Deferred.done(deferred, exit);
      if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
      return { guide: exit.value, cached: false };
    },
  );

  return DiffGuideService.of({ status, setApiKey, generate });
});

export const layer = Layer.effect(DiffGuideService, make);
