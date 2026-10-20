import { linearIssueIdentifierOf, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadLinearIssues from "../../../linear/ThreadLinearIssues.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  LinearIssueThreadNotFoundError,
  LinearIssueThreadRequiredError,
  LinearIssueUrlInvalidError,
  LinearIssuesToolkit,
} from "./tools.ts";

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const issues = yield* ThreadLinearIssues.ThreadLinearIssues;

  // Linear links ride on the pull request capability: both are what a thread's work is tracked by.
  const requireThread = Effect.fn("LinearIssuesToolkit.requireThread")(function* (
    requested: ThreadId | undefined,
  ) {
    const scope = yield* McpInvocationContext.requireMcpCapability("pull-requests");
    const threadId = requested ?? scope.thread?.threadId;
    if (threadId === undefined) return yield* new LinearIssueThreadRequiredError();
    const thread = yield* engine.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
    if (thread === null || thread === undefined || thread.deletedAt !== null) {
      return yield* new LinearIssueThreadNotFoundError({ threadId });
    }
    return thread.id;
  });

  const writesThread = <P extends { readonly threadId?: ThreadId | undefined }, A, E, R>(
    handle: (params: P) => Effect.Effect<A, E, R>,
  ) => McpToolAccess.writesThreads((params: P) => [params.threadId], handle);

  return {
    link_linear_issue: writesThread((input) =>
      Effect.gen(function* () {
        const threadId = yield* requireThread(input.threadId);
        const identifier = linearIssueIdentifierOf(input.url);
        if (identifier === null) return yield* new LinearIssueUrlInvalidError();
        const { alreadyLinked } = yield* issues.link(threadId, {
          identifier,
          url: input.url,
          title: input.title,
        });
        return { identifier, alreadyLinked };
      }),
    ),
    unlink_linear_issue: writesThread((input) =>
      Effect.gen(function* () {
        const threadId = yield* requireThread(input.threadId);
        const identifier = linearIssueIdentifierOf(input.issue) ?? input.issue;
        return yield* issues.unlink(threadId, identifier);
      }),
    ),
    list_thread_linear_issues: McpToolAccess.reads((input) =>
      requireThread(input.threadId).pipe(
        Effect.flatMap(issues.list),
        Effect.map((list) => ({ issues: list })),
      ),
    ),
  } satisfies McpToolAccess.Handlers<typeof LinearIssuesToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(LinearIssuesToolkit, make);
