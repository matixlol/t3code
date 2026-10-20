import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ThreadLinearIssues from "./ThreadLinearIssues.ts";

const layer = ThreadLinearIssues.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
const thread = ThreadId.make("thread-a");
const other = ThreadId.make("thread-b");
const issue = {
  identifier: "ENG-1",
  url: "https://linear.app/acme/issue/ENG-1/first",
  title: "First",
};

it.layer(layer)("ThreadLinearIssues", (it) => {
  it.effect("links per thread, relinks by updating, and unlinks", () =>
    Effect.gen(function* () {
      const issues = yield* ThreadLinearIssues.ThreadLinearIssues;
      assert.deepStrictEqual(yield* issues.link(thread, issue), { alreadyLinked: false });
      assert.deepStrictEqual(yield* issues.link(thread, { ...issue, title: "Renamed" }), {
        alreadyLinked: true,
      });
      const [linked] = yield* issues.list(thread);
      assert.strictEqual(linked?.title, "Renamed");
      assert.strictEqual((yield* issues.list(other)).length, 0);
      assert.deepStrictEqual(yield* issues.unlink(thread, "eng-1"), { wasLinked: true });
      assert.deepStrictEqual(yield* issues.unlink(thread, "ENG-1"), { wasLinked: false });
      assert.strictEqual((yield* issues.list(thread)).length, 0);
    }),
  );

  it.effect("keeps its table out of the recorded migrations", () =>
    Effect.gen(function* () {
      yield* ThreadLinearIssues.ThreadLinearIssues;
      const sql = yield* SqlClient.SqlClient;
      const recorded = yield* sql<{ readonly name: string }>`
        SELECT name FROM effect_sql_migrations WHERE name LIKE '%linear%'
      `;
      assert.strictEqual(recorded.length, 0);
    }),
  );

  it.effect("streams a thread's issues now and after each change", () =>
    Effect.gen(function* () {
      const issues = yield* ThreadLinearIssues.ThreadLinearIssues;
      const fiber = yield* issues
        .changes(other)
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      // A change on another thread re-reads but emits nothing new for this one.
      yield* issues.link(thread, { ...issue, identifier: "ENG-2" });
      yield* issues.link(other, issue);
      const seen = Array.from(yield* Fiber.join(fiber));
      assert.deepStrictEqual(
        seen.map((list) => list.map((entry) => entry.identifier)),
        [[], ["ENG-1"]],
      );
    }),
  );
});
