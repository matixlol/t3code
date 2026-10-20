import { describe, expect, it } from "vite-plus/test";

import { linearIssueIdentifierOf } from "./linearIssue.ts";

describe("linearIssueIdentifierOf", () => {
  it("reads the identifier from an issue URL, with or without its slug", () => {
    expect(linearIssueIdentifierOf("https://linear.app/acme/issue/ENG-123/fix-the-thing")).toBe(
      "ENG-123",
    );
    expect(linearIssueIdentifierOf("https://linear.app/acme/issue/eng-7")).toBe("ENG-7");
  });

  it("rejects URLs that are not Linear issues", () => {
    expect(linearIssueIdentifierOf("https://linear.app/acme/project/ENG-1")).toBeNull();
    expect(linearIssueIdentifierOf("https://example.com/acme/issue/ENG-1")).toBeNull();
    expect(linearIssueIdentifierOf("ENG-1")).toBeNull();
  });
});
