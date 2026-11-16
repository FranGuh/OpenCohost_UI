import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The smallest usable desktop areas the app must open on:
//  - 1366x768 at 100% scale, minus a 40px taskbar -> 1366x728
//  - 1920x1080 at 150% scale = 1280x720 logical, minus a ~40px taskbar -> 1280x680
const SMALLEST_WORK_AREA = { width: 1280, height: 680 };

describe("main window floor in tauri.conf.json", () => {
  const conf = JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
  const main = conf.app.windows.find((w: { label: string }) => w.label === "main");

  it("fits the smallest supported work area", () => {
    expect(main.minWidth).toBeLessThanOrEqual(SMALLEST_WORK_AREA.width);
    expect(main.minHeight).toBeLessThanOrEqual(SMALLEST_WORK_AREA.height);
  });

  it("keeps a floor the three-column shell can still lay out in", () => {
    expect(main.minWidth).toBeGreaterThanOrEqual(1100);
    expect(main.minHeight).toBeGreaterThanOrEqual(600);
  });

  it("opens at a default size that is not smaller than the floor", () => {
    expect(main.width).toBeGreaterThanOrEqual(main.minWidth);
    expect(main.height).toBeGreaterThanOrEqual(main.minHeight);
  });
});
