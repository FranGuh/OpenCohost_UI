import { describe, expect, it } from "vitest";
import { BLUR_GRACE_MS, shouldCollapseOnBlur } from "./blurGrace.js";

describe("shouldCollapseOnBlur", () => {
  it("ignores a blur that lands right after the click that activated the window", () => {
    expect(shouldCollapseOnBlur(1_000, 900)).toBe(false);
    expect(shouldCollapseOnBlur(1_000 + BLUR_GRACE_MS - 1, 1_000)).toBe(false);
  });

  it("collapses on a genuine blur once the grace period has passed", () => {
    expect(shouldCollapseOnBlur(1_000 + BLUR_GRACE_MS, 1_000)).toBe(true);
    expect(shouldCollapseOnBlur(60_000, 1_000)).toBe(true);
  });

  it("collapses when there has been no interaction at all", () => {
    expect(shouldCollapseOnBlur(1_000, null)).toBe(true);
  });
});
