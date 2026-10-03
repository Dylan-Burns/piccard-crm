import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/customers/123?tab=files#top", "/customers/123?tab=files#top"],
    ["/set-password", "/set-password"],
  ])("allows %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["dashboard"],
    ["https://evil.com"],
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\\/evil.com"],
    ["\\\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["javascript:alert(1)"],
  ])("rejects %j", (input) => {
    expect(safeRedirectPath(input)).toBeNull();
  });

  it("keeps encoded slashes inside the path, on this site", () => {
    expect(safeRedirectPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});
