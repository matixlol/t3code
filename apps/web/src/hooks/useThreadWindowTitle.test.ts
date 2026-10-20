import { describe, expect, it } from "vite-plus/test";

import { threadWindowTitle } from "./useThreadWindowTitle";

describe("threadWindowTitle", () => {
  it("leads with Linear issues and flattens the last prompt", () => {
    expect(
      threadWindowTitle({
        linearIssues: [
          {
            identifier: "ENG-1",
            title: "Fix crons",
            url: "https://linear.app/a/issue/ENG-1",
            linkedAt: "2026-10-20T00:00:00.000Z",
          },
        ],
        threadTitle: "Cron transactions",
        branch: "matias/cron",
        projectName: "monorepo",
        worktreePath: null,
        lastPrompt: "Run it\n\noutside   the transaction",
      }),
    ).toBe(
      "ENG-1 Fix crons — Cron transactions — branch matias/cron — project monorepo — prompt: Run it outside the transaction",
    );
  });

  it("cuts a long prompt short", () => {
    const title = threadWindowTitle({
      linearIssues: [],
      threadTitle: "T",
      branch: null,
      projectName: null,
      worktreePath: null,
      lastPrompt: "x".repeat(1000),
    });
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThan(420);
  });
});
