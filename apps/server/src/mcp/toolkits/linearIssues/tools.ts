import {
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  ThreadId,
  ThreadLinearIssue,
  ThreadLinearIssueError,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLinearIssues from "../../../linear/ThreadLinearIssues.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  Orchestrator.OrchestratorV2,
  ThreadLinearIssues.ThreadLinearIssues,
];

const threadId = Schema.optional(
  ThreadId.annotate({ description: "Thread to act on. Omit for this thread." }),
);

export class LinearIssueUrlInvalidError extends Schema.TaggedError<LinearIssueUrlInvalidError>()(
  "LinearIssueUrlInvalidError",
  {},
) {
  override get message(): string {
    return "Pass the issue's Linear URL, for example https://linear.app/acme/issue/ENG-123/some-title.";
  }
}

export class LinearIssueThreadRequiredError extends Schema.TaggedError<LinearIssueThreadRequiredError>()(
  "LinearIssueThreadRequiredError",
  {},
) {
  override get message(): string {
    return "Pass threadId: this MCP client is not running inside a T3 thread.";
  }
}

export class LinearIssueThreadNotFoundError extends Schema.TaggedError<LinearIssueThreadNotFoundError>()(
  "LinearIssueThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export const LinearIssueToolError = Schema.Union([
  OrchestratorMcpFailure,
  McpCapabilityUnavailableError,
  ThreadLinearIssueError,
  LinearIssueUrlInvalidError,
  LinearIssueThreadRequiredError,
  LinearIssueThreadNotFoundError,
]);

const LinkLinearIssueTool = Tool.make("link_linear_issue", {
  description:
    "Link a Linear issue to this thread so it shows beside the thread's pull requests. Call it as soon as you know which Linear issue the thread works on, for example one the user named or linked, or one you created or looked up. Pass the issue's URL and its current title. Linking an issue that is already linked updates its title and succeeds with alreadyLinked=true.",
  parameters: Schema.Struct({
    threadId,
    url: TrimmedNonEmptyString.annotate({
      description: "The issue's Linear URL, for example https://linear.app/acme/issue/ENG-123.",
    }),
    title: TrimmedNonEmptyString.annotate({ description: "The issue's title in Linear." }),
  }),
  success: Schema.Struct({
    identifier: Schema.String,
    alreadyLinked: Schema.Boolean,
  }),
  failure: LinearIssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link Linear issue to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnlinkLinearIssueTool = Tool.make("unlink_linear_issue", {
  description:
    "Remove a Linear issue link from this thread, for example one linked by mistake. Pass the issue's identifier (ENG-123) or its URL. Unlinking an issue that is not linked succeeds with wasLinked=false.",
  parameters: Schema.Struct({
    threadId,
    issue: TrimmedNonEmptyString.annotate({
      description: "The issue's identifier, for example ENG-123, or its Linear URL.",
    }),
  }),
  success: Schema.Struct({ wasLinked: Schema.Boolean }),
  failure: LinearIssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink Linear issue from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListThreadLinearIssuesTool = Tool.make("list_thread_linear_issues", {
  description: "List the Linear issues linked to a thread (omit threadId for this thread).",
  parameters: Schema.Struct({ threadId }),
  success: Schema.Struct({ issues: Schema.Array(ThreadLinearIssue) }),
  failure: LinearIssueToolError,
  dependencies,
})
  .annotate(Tool.Title, "List thread Linear issues")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const LinearIssuesToolkit = Toolkit.make(
  LinkLinearIssueTool,
  UnlinkLinearIssueTool,
  ListThreadLinearIssuesTool,
);
