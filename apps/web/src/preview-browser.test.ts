import { describe, expect, it } from "vitest";

import { normalizePreviewUrl } from "./preview-browser";

describe("normalizePreviewUrl", () => {
  it("preserves explicit http and https urls", () => {
    expect(normalizePreviewUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(normalizePreviewUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it("adds http for localhost urls without a scheme", () => {
    expect(normalizePreviewUrl("localhost:4173/test")).toBe("http://localhost:4173/test");
    expect(normalizePreviewUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000/");
  });

  it("adds https for bare hostnames without a scheme", () => {
    expect(normalizePreviewUrl("example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  it("rejects unsupported protocols and malformed values", () => {
    expect(normalizePreviewUrl("file:///tmp/index.html")).toBeNull();
    expect(normalizePreviewUrl("ws://localhost:3000")).toBeNull();
    expect(normalizePreviewUrl("not a url")).toBeNull();
    expect(normalizePreviewUrl("   ")).toBeNull();
  });
});
