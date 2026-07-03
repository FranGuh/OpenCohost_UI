import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge.js";

describe("Badge tone mapping", () => {
  it.each([
    ["ok", "text-ok"],
    ["warn", "text-warn"],
    ["danger", "text-danger"],
    ["info", "text-info"],
    ["neutral", "text-muted-foreground"]
  ] as const)("tone=%s renders the %s tint + a dot", (tone, expectedClass) => {
    render(<Badge tone={tone}>Sistema: listo</Badge>);
    const badge = screen.getByText("Sistema: listo");
    expect(badge).toHaveAttribute("data-tone", tone);
    expect(badge.className).toContain(expectedClass);
    // the dot is a decorative child span, not separate accessible text
    expect(badge.querySelector("span[aria-hidden='true']")).toBeInTheDocument();
  });

  it("defaults to neutral tone when none is given", () => {
    render(<Badge>Voz: —</Badge>);
    expect(screen.getByText("Voz: —")).toHaveAttribute("data-tone", "neutral");
  });

  it("renders technical values in mono/tabular-nums when mono is set", () => {
    render(<Badge mono>qwen3-tts</Badge>);
    expect(screen.getByText("qwen3-tts").className).toContain("mono");
  });
});
