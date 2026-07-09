import { beforeEach, describe, expect, it } from "vitest";
import { EVENT_CAP, selectEvents, useEventStore } from "./eventStore.js";
import type { AppEvent } from "./eventStore.js";

function makeEvent(id: string, ts = Date.now()): AppEvent {
  return { id, ts, source: "model", label: `event ${id}`, tone: "ok" };
}

describe("eventStore (bounded ring buffer)", () => {
  beforeEach(() => {
    useEventStore.setState({ events: [] });
  });

  it("append adds an event retrievable via selectEvents", () => {
    const event = makeEvent("e1", 123);
    useEventStore.getState().append(event);
    expect(selectEvents(useEventStore.getState())).toEqual([event]);
  });

  it("dedups by id: a repeated append keeps length 1 and returns the identical state object (no-rerender no-op)", () => {
    useEventStore.getState().append(makeEvent("e1", 100));
    const before = useEventStore.getState();
    useEventStore.getState().append(makeEvent("e1", 999)); // same id, different payload — still a no-op
    const after = useEventStore.getState();
    expect(before).toBe(after);
    expect(after.events).toHaveLength(1);
  });

  it("evicts oldest-first once the ring exceeds EVENT_CAP, preserving oldest->newest order", () => {
    for (let i = 0; i < EVENT_CAP + 10; i++) {
      useEventStore.getState().append(makeEvent(`e${i}`, i));
    }
    const events = selectEvents(useEventStore.getState());
    expect(events).toHaveLength(EVENT_CAP);
    // ids 0-9 evicted
    for (let i = 0; i < 10; i++) {
      expect(events.some((e) => e.id === `e${i}`)).toBe(false);
    }
    // newest present
    expect(events.some((e) => e.id === `e${EVENT_CAP + 9}`)).toBe(true);
    // order preserved oldest -> newest
    expect(events[0].id).toBe("e10");
    expect(events[events.length - 1].id).toBe(`e${EVENT_CAP + 9}`);
  });
});
