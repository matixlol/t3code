import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as ReviewService from "../review/ReviewService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as DiffGuideService from "./DiffGuideService.ts";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1,2 @@",
  " const a = 1;",
  "+const b = 2;",
  "diff --git a/src/a.test.ts b/src/a.test.ts",
  "--- a/src/a.test.ts",
  "+++ b/src/a.test.ts",
  "@@ -1 +1,2 @@",
  " test();",
  "+test(b);",
].join("\n");

const reply = {
  provider: "Together",
  choices: [
    {
      message: {
        content: JSON.stringify({
          summary: "Adds `b`.",
          sections: [{ title: "Add b", body: "Defines `b`.", files: ["src/a.ts"] }],
        }),
      },
    },
  ],
};

const layerFor = (requests: Array<string>, contextLines: Array<number | undefined>) =>
  DiffGuideService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({
          getTurnDiff: (input) => {
            contextLines.push(input.contextLines);
            return Effect.succeed({
              threadId: input.threadId,
              fromTurnCount: input.fromTurnCount,
              toTurnCount: input.toTurnCount,
              diff,
            });
          },
        }),
        Layer.mock(ReviewService.ReviewService)({}),
        Layer.mock(PullRequestService.PullRequestService)({}),
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              requests.push(request.url);
              return HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify(reply), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
              );
            }),
          ),
        ),
      ),
    ),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-diff-guide-test-" })),
    ),
    Layer.provideMerge(NodeCrypto.layer),
    Layer.provideMerge(NodeServices.layer),
  );

const target = {
  _tag: "Checkpoint" as const,
  threadId: ThreadId.make("thread-1"),
  fromTurnCount: 0,
  toTurnCount: 1,
};

it.effect("writes a guide from the extended diff, then answers the same diff from cache", () => {
  const requests: Array<string> = [];
  const contextLines: Array<number | undefined> = [];
  return Effect.gen(function* () {
    const service = yield* DiffGuideService.DiffGuideService;
    yield* service.setApiKey("sk-or-test");

    const first = yield* service.generate({ target });
    assert.isFalse(first.cached);
    assert.strictEqual(first.guide?.provider, "Together");
    assert.strictEqual(first.guide?.contextLines, 20);
    // The model left the test out; it still lands in a closing section.
    assert.deepStrictEqual(
      first.guide?.sections.map((section) => section.files),
      [["src/a.ts"], ["src/a.test.ts"]],
    );

    const second = yield* service.generate({ target });
    assert.isTrue(second.cached);
    assert.deepStrictEqual(second.guide, first.guide);
    assert.deepStrictEqual(requests, ["https://openrouter.ai/api/v1/chat/completions"]);
    assert.deepStrictEqual(contextLines, [20, 20]);
  }).pipe(Effect.provide(layerFor(requests, contextLines)));
});

it.effect("asks for a key before spending a request", () => {
  const requests: Array<string> = [];
  return Effect.gen(function* () {
    const service = yield* DiffGuideService.DiffGuideService;
    const error = yield* Effect.flip(service.generate({ target }));
    assert.strictEqual(error.reason, "not-configured");
    assert.deepStrictEqual(requests, []);
    assert.isFalse((yield* service.status).configured);
  }).pipe(Effect.provide(layerFor(requests, [])));
});
