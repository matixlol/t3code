import { describe, expect, it } from "vite-plus/test";

import {
  fitDiffToBudget,
  normalizeDiffGuide,
  parseDiffGuideReply,
  splitDiffFiles,
} from "./diffGuideModel.ts";

const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "+const b = 2;",
  "diff --git a/src/gone.ts b/src/gone.ts",
  "deleted file mode 100644",
  "--- a/src/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "diff --git a/old/name.ts b/new/name.ts",
  "similarity index 90%",
  "rename from old/name.ts",
  "rename to new/name.ts",
  "diff --git a/docs/new.md b/docs/new.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/docs/new.md",
  "@@ -0,0 +1 @@",
  "+hello",
].join("\n");

describe("splitDiffFiles", () => {
  it("names files by new path, or old path when deleted, including pure renames", () => {
    expect(splitDiffFiles(patch).map((file) => file.path)).toEqual([
      "src/a.ts",
      "src/gone.ts",
      "new/name.ts",
      "docs/new.md",
    ]);
  });

  it("keeps each file's text whole", () => {
    const [first] = splitDiffFiles(patch);
    expect(first?.text.startsWith("diff --git a/src/a.ts")).toBe(true);
    expect(first?.text.endsWith("+const b = 2;")).toBe(true);
  });
});

describe("fitDiffToBudget", () => {
  it("lists files past the budget by name only", () => {
    const files = splitDiffFiles(patch);
    const fitted = fitDiffToBudget(files, files[0]!.text.length + 1);
    expect(fitted.truncated).toBe(true);
    expect(fitted.diff).toContain("+const b = 2;");
    expect(fitted.diff).not.toContain("-gone");
    expect(fitted.diff).toContain("#   src/gone.ts");
  });

  it("returns the whole diff when it fits", () => {
    const files = splitDiffFiles(patch);
    expect(fitDiffToBudget(files, 1_000_000)).toEqual({ diff: patch, truncated: false });
  });
});

describe("parseDiffGuideReply", () => {
  it("reads JSON inside code fences", () => {
    expect(parseDiffGuideReply('```json\n{"summary":"s","sections":[]}\n```')).toEqual({
      summary: "s",
      sections: [],
    });
  });

  it("returns null for prose", () => {
    expect(parseDiffGuideReply("I cannot help with that")).toBeNull();
  });
});

describe("normalizeDiffGuide", () => {
  const changed = ["src/a.ts", "src/gone.ts", "new/name.ts", "docs/new.md"];

  it("drops unknown paths and duplicates, and collects left-out files at the end", () => {
    const guide = normalizeDiffGuide(
      {
        summary: " Adds b. ",
        sections: [
          { title: "Core", body: "Adds `b`.", files: ["b/src/a.ts", "src/missing.ts"] },
          { title: "Again", body: "", files: ["src/a.ts"] },
          { title: "Docs", body: "Docs.", files: ["/docs/new.md"] },
        ],
      },
      changed,
    );
    expect(guide).toEqual({
      summary: "Adds b.",
      sections: [
        { title: "Core", body: "Adds `b`.", files: ["src/a.ts"] },
        { title: "Docs", body: "Docs.", files: ["docs/new.md"] },
        { title: "Other changes", body: "", files: ["src/gone.ts", "new/name.ts"] },
      ],
    });
  });

  it("survives a malformed reply", () => {
    expect(normalizeDiffGuide({ sections: "nope" }, ["a.ts"])).toEqual({
      summary: "",
      sections: [{ title: "Other changes", body: "", files: ["a.ts"] }],
    });
  });
});
