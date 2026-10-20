/**
 * Mode shares T3 Code's database, so this table is created here rather than by a recorded
 * migration: the migration history stays exactly what T3 Code expects, so either app can open
 * the database after the other.
 */
import { ThreadLinearIssue, ThreadLinearIssueError, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export interface LinearIssueToLink {
  readonly identifier: string;
  readonly url: string;
  readonly title: string;
}

export class ThreadLinearIssues extends Context.Service<
  ThreadLinearIssues,
  {
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<ThreadLinearIssue>, ThreadLinearIssueError>;
    /** Links the issue, or updates its title and URL when it is already linked. */
    readonly link: (
      threadId: ThreadId,
      issue: LinearIssueToLink,
    ) => Effect.Effect<{ readonly alreadyLinked: boolean }, ThreadLinearIssueError>;
    readonly unlink: (
      threadId: ThreadId,
      identifier: string,
    ) => Effect.Effect<{ readonly wasLinked: boolean }, ThreadLinearIssueError>;
    /** The thread's issues now, then again after each change. */
    readonly changes: (
      threadId: ThreadId,
    ) => Stream.Stream<ReadonlyArray<ThreadLinearIssue>, ThreadLinearIssueError>;
  }
>()("t3/linear/ThreadLinearIssues") {}

const decodeIssues = Schema.decodeUnknownEffect(Schema.Array(ThreadLinearIssue));

const failed = (operation: string) => (cause: unknown) =>
  new ThreadLinearIssueError({
    detail: `Could not ${operation} Linear issues: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Bumped on every write. Few clients watch at once and a thread has a handful of issues, so a
  // watcher re-reads its own thread on any change rather than tracking which thread changed.
  const version = yield* SubscriptionRef.make(0);

  yield* sql`
    CREATE TABLE IF NOT EXISTS mode_thread_linear_issues (
      thread_id TEXT NOT NULL,
      identifier TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, identifier)
    )
  `.pipe(Effect.orDie);

  const list = (threadId: ThreadId) =>
    sql`
      SELECT identifier, url, title, linked_at AS "linkedAt"
      FROM mode_thread_linear_issues
      WHERE thread_id = ${threadId}
      ORDER BY linked_at, identifier
    `.pipe(Effect.flatMap(decodeIssues), Effect.mapError(failed("read")));

  const bump = SubscriptionRef.update(version, (n) => n + 1);

  return ThreadLinearIssues.of({
    list,
    link: Effect.fn("ThreadLinearIssues.link")(
      function* (threadId: ThreadId, issue: LinearIssueToLink) {
        const now = DateTime.formatIso(yield* DateTime.now);
        const existing = yield* sql<{ readonly n: number }>`
          SELECT COUNT(*) AS n FROM mode_thread_linear_issues
          WHERE thread_id = ${threadId} AND identifier = ${issue.identifier}
        `;
        yield* sql`
          INSERT INTO mode_thread_linear_issues (thread_id, identifier, url, title, linked_at)
          VALUES (${threadId}, ${issue.identifier}, ${issue.url}, ${issue.title}, ${now})
          ON CONFLICT (thread_id, identifier)
          DO UPDATE SET url = excluded.url, title = excluded.title
        `;
        yield* bump;
        return { alreadyLinked: (existing[0]?.n ?? 0) > 0 };
      },
      Effect.mapError(failed("link")),
    ),
    unlink: Effect.fn("ThreadLinearIssues.unlink")(
      function* (threadId: ThreadId, identifier: string) {
        const removed = yield* sql<{ readonly identifier: string }>`
          DELETE FROM mode_thread_linear_issues
          WHERE thread_id = ${threadId} AND identifier = ${identifier.toUpperCase()}
          RETURNING identifier
        `;
        yield* bump;
        return { wasLinked: removed.length > 0 };
      },
      Effect.mapError(failed("unlink")),
    ),
    changes: (threadId) =>
      SubscriptionRef.changes(version).pipe(
        Stream.mapEffect(() => list(threadId)),
        Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      ),
  });
});

export const layer = Layer.effect(ThreadLinearIssues, make);
