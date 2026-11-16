import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  formatComputeMs,
  formatTokens,
  intensityLevel,
  totalsOf,
  type UsageDay
} from "./usageAggregate.js";

const day = (date: string, calls: number, prompt: number, completion: number, ms: number): UsageDay => ({
  date,
  calls,
  prompt_tokens: prompt,
  completion_tokens: completion,
  compute_ms: ms
});

describe("formatComputeMs", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatComputeMs(0)).toBe("0s");
    expect(formatComputeMs(45_000)).toBe("45s");
    expect(formatComputeMs(750_000)).toBe("12m 30s");
    expect(formatComputeMs(7_500_000)).toBe("2h 5m");
  });

  it("rounds sub-second values to the nearest second", () => {
    expect(formatComputeMs(400)).toBe("0s");
    expect(formatComputeMs(1_600)).toBe("2s");
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(9_800)).toBe("9.8k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });
});

describe("intensityLevel", () => {
  it("is 0 for no activity and 1..4 relative to the max", () => {
    expect(intensityLevel(0, 100)).toBe(0);
    expect(intensityLevel(1, 100)).toBe(1);
    expect(intensityLevel(50, 100)).toBe(2);
    expect(intensityLevel(75, 100)).toBe(3);
    expect(intensityLevel(100, 100)).toBe(4);
    expect(intensityLevel(5, 0)).toBe(0);
  });
});

describe("totalsOf", () => {
  it("sums calls, tokens and compute time", () => {
    expect(totalsOf([day("2026-11-08", 2, 100, 10, 1000), day("2026-11-09", 3, 50, 5, 2000)])).toEqual({
      calls: 5,
      promptTokens: 150,
      completionTokens: 15,
      computeMs: 3000
    });
  });
});

describe("buildCalendar", () => {
  const to = "2026-11-09"; // a Monday

  it("day: lays out the last 365 days in week columns, Monday first", () => {
    const cal = buildCalendar([day("2026-11-09", 12, 9000, 800, 15000)], "day", to);
    expect(cal.cells).toHaveLength(365);
    expect(cal.cells[0].key).toBe("2025-11-10");
    expect(cal.cells[364].key).toBe("2026-11-09");
    const last = cal.cells[364];
    expect(last.row).toBe(0); // Monday
    expect(last.calls).toBe(12);
    expect(last.tokens).toBe(9800);
    expect(last.computeMs).toBe(15000);
    expect(last.level).toBe(4);
    expect(cal.cells[0].col).toBe(0);
    expect(last.col).toBe(cal.columns - 1);
    expect(cal.cells.find((c) => c.key === "2026-11-08")?.level).toBe(0);
  });

  it("week: aggregates by Monday-start week", () => {
    const cal = buildCalendar(
      [day("2026-11-03", 1, 100, 0, 1000), day("2026-11-08", 2, 200, 0, 2000), day("2026-11-09", 4, 400, 0, 4000)],
      "week",
      to
    );
    const prev = cal.cells.find((c) => c.key === "2026-11-02");
    const cur = cal.cells.find((c) => c.key === "2026-11-09");
    expect(prev).toMatchObject({ calls: 3, tokens: 300, computeMs: 3000 });
    expect(cur).toMatchObject({ calls: 4, tokens: 400 });
    expect(cal.cells[cal.cells.length - 1].key).toBe("2026-11-09");
    expect(cal.cells.every((c) => c.row === 0)).toBe(true);
  });

  it("month: aggregates by calendar month over the last 12 months", () => {
    const cal = buildCalendar(
      [day("2026-10-31", 1, 10, 0, 100), day("2026-11-01", 2, 20, 0, 200), day("2026-11-09", 3, 30, 0, 300)],
      "month",
      to
    );
    expect(cal.cells[cal.cells.length - 1].key).toBe("2026-11");
    expect(cal.cells.find((c) => c.key === "2026-11")).toMatchObject({ calls: 5, tokens: 50 });
    expect(cal.cells.find((c) => c.key === "2026-10")).toMatchObject({ calls: 1, tokens: 10 });
    expect(cal.cells.length).toBeGreaterThanOrEqual(12);
  });

  it("year: aggregates by calendar year across the window", () => {
    const cal = buildCalendar(
      [day("2025-12-01", 1, 10, 0, 100), day("2026-11-09", 3, 30, 0, 300)],
      "year",
      to
    );
    expect(cal.cells.map((c) => c.key)).toEqual(["2025", "2026"]);
    expect(cal.cells[0]).toMatchObject({ calls: 1, tokens: 10 });
    expect(cal.cells[1]).toMatchObject({ calls: 3, tokens: 30 });
  });

  it("ignores rows outside the window", () => {
    const cal = buildCalendar([day("2020-01-01", 9, 999, 0, 9)], "day", to);
    expect(cal.cells.every((c) => c.calls === 0)).toBe(true);
  });
});
