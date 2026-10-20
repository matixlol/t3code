import type { DiffGuide } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupByDiffGuide, orderByDiffGuide } from "./diffGuideOrder";

const guide: DiffGuide = {
  summary: "",
  sections: [
    { title: "Contract", body: "", files: ["b.ts", "a.ts"] },
    { title: "UI", body: "", files: ["c.tsx"] },
  ],
  model: "m",
  provider: null,
  generatedAt: "2026-10-19T00:00:00.000Z",
  durationMs: 0,
  contextLines: 20,
};

describe("orderByDiffGuide", () => {
  it("orders files by section and keeps files the guide does not name at the end", () => {
    const ordered = orderByDiffGuide(["late.ts", "c.tsx", "a.ts", "b.ts"], guide, (path) => path);
    expect(ordered).toEqual(["b.ts", "a.ts", "c.tsx", "late.ts"]);
  });

  it("keeps the diff's order without a guide", () => {
    expect(orderByDiffGuide(["z", "a"], null, (path) => path)).toEqual(["z", "a"]);
  });
});

describe("groupByDiffGuide", () => {
  it("groups loaded files by section and leaves sections with none out", () => {
    const groups = groupByDiffGuide(["late.ts", "a.ts", "b.ts"], guide, (path) => path);
    expect(groups.map((group) => [group.number, group.items])).toEqual([
      [1, ["b.ts", "a.ts"]],
      [null, ["late.ts"]],
    ]);
  });

  it("puts every file in one group without a guide", () => {
    const groups = groupByDiffGuide(["z", "a"], null, (path) => path);
    expect(groups.map((group) => [group.section, group.items])).toEqual([[null, ["z", "a"]]]);
  });
});
