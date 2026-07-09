import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { eventsHandler } from "../test/handlers.js";
import { useEventStore } from "../store/eventStore.js";
import { setToastSink } from "../lib/appEvents.js";
import { useServerEventLog } from "./events.js";
import type { EventLogResponse } from "./events.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.useFakeTimers();
  useEventStore.setState({ events: [] });
  setToastSink(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useServerEventLog", () => {
  it("emits a whitelisted server event through emitAppEvent as srv-<seq>, without toasting", async () => {
    const toast = vi.fn();
    setToastSink(toast);
    // Server ts is Python time.time() = epoch SECONDS; the client store
    // interleaves by JS milliseconds, so the hook must convert (* 1000)
    // instead of stamping Date.now() — cold-start backfill keeps chronology.
    const serverTsSeconds = 1720000000;
    const batch: EventLogResponse = {
      events: [{ seq: 1, ts: serverTsSeconds, source: "motor", action: "ready", detail: null }],
      cursor: 1,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "srv-1", label: "Motor: listo", source: "motor" });
    expect(events[0].ts).toBe(serverTsSeconds * 1000);
    expect(events[0].ts).not.toBe(Date.now());
    expect(toast).not.toHaveBeenCalled();
  });

  it("drops an unmapped/per-turn action (idle) — never reaches the feed", async () => {
    const batch: EventLogResponse = {
      events: [{ seq: 1, ts: 0, source: "motor", action: "idle", detail: null }],
      cursor: 1,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useEventStore.getState().events).toHaveLength(0);
  });

  it("does not re-emit an already-seen seq on a later poll", async () => {
    const batch: EventLogResponse = {
      events: [{ seq: 1, ts: 0, source: "motor", action: "ready", detail: null }],
      cursor: 1,
      boot: 100
    };
    // Same batch served again (e.g. a caught-up-but-not-since-filtered replay) —
    // seq 1 is already <= lastCursor after the first poll, so it must be a no-op.
    server.use(eventsHandler([batch, batch]));

    const { result } = renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(useEventStore.getState().events).toHaveLength(1);

    // Trigger the next poll deterministically via refetch() instead of relying
    // on exact fake-timer/interval alignment (cadence itself is covered elsewhere).
    await act(async () => {
      await result.current.refetch();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useEventStore.getState().events).toHaveLength(1);
  });

  it("on a boot change, adopts the new cursor WITHOUT emitting that batch; later genuinely-new events still emit", async () => {
    const first: EventLogResponse = {
      events: [{ seq: 1, ts: 0, source: "motor", action: "ready", detail: null }],
      cursor: 1,
      boot: 100
    };
    // Restart: boot changes AND seq resets to 1 again — must not collide/duplicate.
    const restarted: EventLogResponse = {
      events: [{ seq: 1, ts: 0, source: "motor", action: "speaking_start", detail: null }],
      cursor: 1,
      boot: 200
    };
    const afterRestart: EventLogResponse = {
      events: [{ seq: 2, ts: 0, source: "motor", action: "model_changed", detail: null }],
      cursor: 2,
      boot: 200
    };
    server.use(eventsHandler([first, restarted, afterRestart]));

    const { result } = renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(useEventStore.getState().events).toHaveLength(1);
    expect(useEventStore.getState().events[0].id).toBe("srv-1");

    await act(async () => {
      await result.current.refetch(); // restart batch: adopted, not emitted
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useEventStore.getState().events).toHaveLength(1);

    await act(async () => {
      await result.current.refetch(); // genuinely-new post-restart event
      await vi.advanceTimersByTimeAsync(0);
    });
    const events = useEventStore.getState().events;
    expect(events).toHaveLength(2);
    expect(events[1].id).toBe("srv-2");
    expect(events[1].label).toBe("Motor: modelo cambiado");
  });
});
