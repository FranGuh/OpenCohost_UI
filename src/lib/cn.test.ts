import { describe, expect, it } from "vitest";
import { cn } from "./cn.js";

describe("cn", () => {
  // Regression for a wrong tailwind-merge major (v4-targeted 3.x installed
  // against this project's Tailwind v3): its class-group model mis-merges
  // v3 focus-visible utilities and silently drops `outline` (the
  // outline-style utility), leaving width/offset/color but no painted
  // focus ring on any Button — a WCAG 2.4.7 regression. Pin stays at 2.6.0
  // (the major built for Tailwind v3) — do not bump without re-verifying
  // this assertion.
  it("keeps focus-visible:outline when merged with other focus-visible outline utilities", () => {
    const result = cn(
      "focus-visible:outline",
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-ring"
    );

    expect(result).toContain("focus-visible:outline-2");
    expect(result).toContain("focus-visible:outline-offset-2");
    expect(result).toContain("focus-visible:outline-ring");
    expect(result.split(/\s+/)).toContain("focus-visible:outline");
  });
});
