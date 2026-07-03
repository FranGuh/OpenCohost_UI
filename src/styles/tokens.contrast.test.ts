import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// F3 (a11y) regression: the `studio` (light) theme's semantic text tokens
// and primary Button gradient must clear WCAG AA (>=4.5:1 for small text)
// on the white card background they render on. Reads the real tokens.css
// source so a future edit to these hex values can't silently regress
// contrast without failing this test.

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const tokensPath = join(dirname(fileURLToPath(import.meta.url)), "tokens.css");
const tokensCss = readFileSync(tokensPath, "utf-8");

function studioTokenHex(name: string): string {
  const studioBlock = tokensCss.slice(tokensCss.indexOf('[data-theme="studio"]'));
  const match = studioBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) {
    throw new Error(`token --${name} not found in [data-theme="studio"] block`);
  }
  return match[1];
}

function studioAccentGradStops(): [string, string] {
  const studioBlock = tokensCss.slice(tokensCss.indexOf('[data-theme="studio"]'));
  const match = studioBlock.match(/--accent-grad:\s*linear-gradient\([^,]+,\s*(#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)/);
  if (!match) {
    throw new Error("--accent-grad not found in [data-theme=\"studio\"] block");
  }
  return [match[1], match[2]];
}

const WHITE = "#ffffff";
const AA_SMALL_TEXT = 4.5;

describe("studio theme contrast (WCAG AA)", () => {
  it.each(["ok", "warn", "danger", "info"])("--%s meets 4.5:1 against #ffffff", (name) => {
    const hex = studioTokenHex(name);
    expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it("both --accent-grad stops meet 4.5:1 with a white label (primary Button)", () => {
    const [start, end] = studioAccentGradStops();
    expect(contrastRatio(start, WHITE)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    expect(contrastRatio(end, WHITE)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });
});
