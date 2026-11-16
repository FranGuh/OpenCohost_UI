import { beforeEach, describe, expect, it } from "vitest";
import { isVisionActivePhase, useVisionPhaseStore, useVisionResultStore } from "./visionStore.js";

beforeEach(() => useVisionResultStore.setState({ results: [] }));

describe("useVisionResultStore", () => {
  it("appends results, dedups by id and fills describe_ms later", () => {
    const s = useVisionResultStore.getState();
    s.append({ id: "srv-1", ts: 1000, outcome: "ok", describeMs: null });
    s.append({ id: "srv-1", ts: 1000, outcome: "ok", describeMs: null });
    expect(useVisionResultStore.getState().results).toHaveLength(1);
    s.setLookDetails("srv-1", { describeMs: 2100, lookId: "look-1", framesSent: 2 });
    expect(useVisionResultStore.getState().results[0]).toMatchObject({ describeMs: 2100, lookId: "look-1", framesSent: 2 });
  });

  it("caps the ring buffer", () => {
    const s = useVisionResultStore.getState();
    for (let i = 0; i < 70; i += 1) s.append({ id: `srv-${i}`, ts: i, outcome: "ok", describeMs: null });
    const results = useVisionResultStore.getState().results;
    expect(results.length).toBeLessThanOrEqual(50);
    expect(results[results.length - 1]?.id).toBe("srv-69");
  });
});

describe("useVisionPhaseStore", () => {
  beforeEach(() => useVisionPhaseStore.setState({ phase: "idle" }));

  it("starts idle and holds the phase it is given", () => {
    expect(useVisionPhaseStore.getState().phase).toBe("idle");
    useVisionPhaseStore.getState().setPhase("describing");
    expect(useVisionPhaseStore.getState().phase).toBe("describing");
  });

  it("treats looking and describing as an active look, nothing else", () => {
    expect(["idle", "looking", "describing", "done", "failed"].map((p) => isVisionActivePhase(p as never))).toEqual([
      false, true, true, false, false
    ]);
  });
});
