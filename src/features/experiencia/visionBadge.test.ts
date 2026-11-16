import { describe, expect, it } from "vitest";
import { attachVisionBadges } from "./visionBadge.js";

const kira = (id: string, ts: number) => ({ id, role: "kira" as const, text: "hola", ts });
const op = (id: string, ts: number) => ({ id, role: "operator" as const, text: "q", ts });

describe("attachVisionBadges", () => {
  it("attaches a result to the first Kira reply at or after it", () => {
    const map = attachVisionBadges(
      [op("o1", 900), kira("k1", 2000), kira("k2", 5000)],
      [{ id: "srv-1", ts: 1000, outcome: "ok", describeMs: 2100 }]
    );
    expect(map.get("k1")).toEqual({ outcome: "ok", describeMs: 2100 });
    expect(map.has("k2")).toBe(false);
  });

  it("ignores replies before the result, agenda replies and the thinking placeholder", () => {
    const map = attachVisionBadges(
      [kira("old", 500), { id: "ag", role: "kira" as const, text: "x", ts: 1500, fromAgenda: true }, { id: "think", role: "kira" as const, ts: 1600 }, kira("k1", 3000)],
      [{ id: "srv-1", ts: 1000, outcome: "describe_timeout", describeMs: null }]
    );
    expect([...map.keys()]).toEqual(["k1"]);
  });

  it("does not attach to a reply that arrives long after the look", () => {
    const map = attachVisionBadges([kira("late", 1000 + 10 * 60_000)], [{ id: "srv-1", ts: 1000, outcome: "ok", describeMs: 1 }]);
    expect(map.size).toBe(0);
  });

  it("lets the latest result win when two land before one reply", () => {
    const map = attachVisionBadges(
      [kira("k1", 5000)],
      [
        { id: "a", ts: 1000, outcome: "ok", describeMs: 1 },
        { id: "b", ts: 2000, outcome: "black_frame", describeMs: null }
      ]
    );
    expect(map.get("k1")?.outcome).toBe("black_frame");
  });

  it("carries the look id and frame count to the badge", () => {
    const map = attachVisionBadges(
      [kira("k1", 2000)],
      [{ id: "srv-1", ts: 1000, outcome: "ok", describeMs: 2900, lookId: "look-9", framesSent: 3 }]
    );
    expect(map.get("k1")).toMatchObject({ lookId: "look-9", framesSent: 3 });
  });
});
