import { describe, expect, it } from "vite-plus/test";

import { authoredChangeStat, changeBreakdownOf, classifyChangedFile } from "./changedFileKind.ts";

describe("classifyChangedFile", () => {
  it.each([
    ["src/contest.py", "code"],
    ["test/fixtures/pr.json", "mocks"],
    ["pnpm-lock.yaml", "generated"],
    ["convex/_generated/api.d.ts", "generated"],
    ["drizzle/meta/0009_snapshot.json", "generated"],
    ["drizzle/meta/_journal.json", "generated"],
    ["drizzle/0009_add_users.sql", "code"],
    ["src/agent.eval.ts", "tests"],
    ["evals/title-generation.ts", "tests"],
    ["README.md", "docs"],
    ["tests/README.md", "tests"],
  ] as const)("%s is %s", (path, kind) => {
    expect(classifyChangedFile(path)).toBe(kind);
  });
});

describe("authoredChangeStat", () => {
  it("counts code and docs, leaving out tests and generated files", () => {
    const breakdown = changeBreakdownOf([
      { path: "src/a.ts", additions: 10, deletions: 2 },
      { path: "README.md", additions: 3, deletions: 0 },
      { path: "src/a.test.ts", additions: 50, deletions: 5 },
      { path: "pnpm-lock.yaml", additions: 900, deletions: 400 },
    ]);
    expect(authoredChangeStat(breakdown)).toEqual({ additions: 13, deletions: 2 });
  });

  it("falls back to the total when only tests and generated files changed", () => {
    const breakdown = changeBreakdownOf([
      { path: "src/a.test.ts", additions: 4, deletions: 1 },
      { path: "pnpm-lock.yaml", additions: 7, deletions: 3 },
    ]);
    expect(authoredChangeStat(breakdown)).toEqual({ additions: 11, deletions: 4 });
  });
});
