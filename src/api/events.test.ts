import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { http, HttpResponse } from "msw";
import { API_BASE_URL, eventsHandler } from "../test/handlers.js";
import { useEventStore } from "../store/eventStore.js";
import { useVisionOffRequestStore, useVisionPhaseStore, useVisionResultStore } from "../store/visionStore.js";
import { useAvatarLiveState } from "../store/avatarLiveStore.js";
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
  useAvatarLiveState.setState({ speaking: false, lastEventTs: 0 });
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

  it("drops an unmapped/per-turn action (idle) from the feed, but routes it to the avatar store (speaking=false)", async () => {
    useAvatarLiveState.setState({ speaking: true, lastEventTs: 1 });
    const batch: EventLogResponse = {
      events: [{ seq: 1, ts: 0, source: "motor", action: "idle", detail: null }],
      cursor: 1,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useEventStore.getState().events).toHaveLength(0);
    expect(useAvatarLiveState.getState().speaking).toBe(false);
  });

  it("routes motor.speaking_start to the avatar store (speaking=true) without a feed event", async () => {
    const batch: EventLogResponse = {
      events: [{ seq: 1, ts: 0, source: "motor", action: "speaking_start", detail: null }],
      cursor: 1,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useAvatarLiveState.getState().speaking).toBe(true);
    expect(useEventStore.getState().events).toHaveLength(0); // KNOWN_SILENT — never in the feed
  });

  it("routes motor.speaking_end to the avatar store (speaking=false)", async () => {
    useAvatarLiveState.setState({ speaking: true, lastEventTs: 1 });
    const batch: EventLogResponse = {
      events: [{ seq: 1, ts: 0, source: "motor", action: "speaking_end", detail: null }],
      cursor: 1,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useAvatarLiveState.getState().speaking).toBe(false);
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

  it("coalesces N memoria_captured events arriving in one poll batch into a single 'Kira guardó N memorias' line", async () => {
    // E1 (memoria_quality_20260717): three memorias captured between two polls
    // arrive together. The feed must show ONE line, not three identical ones.
    const batch: EventLogResponse = {
      events: [
        { seq: 1, ts: 0, source: "motor", action: "memoria_captured", detail: null },
        { seq: 2, ts: 0, source: "motor", action: "memoria_captured", detail: null },
        { seq: 3, ts: 0, source: "motor", action: "memoria_captured", detail: null }
      ],
      cursor: 3,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Kira guardó 3 memorias");
  });

  it("a lone memoria_captured in a batch stays singular and interleaves with other motor events", async () => {
    const batch: EventLogResponse = {
      events: [
        { seq: 1, ts: 0, source: "motor", action: "ready", detail: null },
        { seq: 2, ts: 0, source: "motor", action: "memoria_captured", detail: null }
      ],
      cursor: 2,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const labels = useEventStore.getState().events.map((e) => e.label);
    expect(labels).toContain("Motor: listo");
    expect(labels).toContain("Kira guardó una memoria");
    expect(labels).not.toContain("Kira guardó 1 memorias");
  });

  it("passes a kira-agenda guardrail event through to the feed, chronologically interleaved with other events (WU4-4b)", async () => {
    const batch: EventLogResponse = {
      events: [
        { seq: 1, ts: 0, source: "motor", action: "ready", detail: null },
        { seq: 2, ts: 0, source: "kira-agenda", action: "guardrail:contains_internal_leak", detail: null }
      ],
      cursor: 2,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("srv-1");
    expect(events[1]).toMatchObject({
      id: "srv-2",
      source: "kira-agenda",
      label: "Guardrail: prefetch rechazado — fuga de contenido interno",
      tone: "warn"
    });
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

  it("reduces a ctx_pressure_high numeric-dict detail to a ratio-percent label (unit 2.5, F10)", async () => {
    const batch: EventLogResponse = {
      events: [
        {
          seq: 1,
          ts: 0,
          source: "motor",
          action: "ctx_pressure_high",
          detail: { ratio: 0.82, effective_ctx: 4096, native_ctx: 8192, evicted_pairs: 5 }
        }
      ],
      cursor: 1,
      boot: 100
    };
    server.use(eventsHandler([batch]));

    renderHook(() => useServerEventLog(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Motor: contexto saturado (82 %)");
  });
});

describe("useServerEventLog vision events", () => {
  function visionClient(looking = false) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["vision"], {
      enabled: true,
      status: { daemon_state: "running", armed: false, looking, state: "ready" }
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    return { queryClient, wrapper };
  }

  it("applies vision_looking to the vision query cache immediately, with no feed row and no unknown-event warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const batch: EventLogResponse = {
      events: [{ seq: 1, ts: 1, source: "vision", action: "vision_looking", detail: { looking: true } }],
      cursor: 1,
      boot: 100
    };
    server.use(eventsHandler([batch]));
    const { queryClient, wrapper } = visionClient();

    renderHook(() => useServerEventLog(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const cached = queryClient.getQueryData<{ status: { looking: boolean } }>(["vision"]);
    expect(cached?.status.looking).toBe(true);
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("dropped unknown event"));
    warn.mockRestore();
  });

  it("routes vision_off_request to the off-request store with no feed row, no warning, and dedupes a replay", async () => {
    useVisionOffRequestStore.setState({ requests: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const batch: EventLogResponse = {
      events: [{ seq: 9, ts: 1720000000, source: "vision", action: "vision_off_request", detail: { reason: "look_requested" } }],
      cursor: 9,
      boot: 100
    };
    server.use(eventsHandler([batch]));
    const { wrapper } = visionClient();

    renderHook(() => useServerEventLog(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useVisionOffRequestStore.getState().requests).toEqual([{ id: "srv-9", ts: 1720000000 * 1000 }]);
    useVisionOffRequestStore.getState().append({ id: "srv-9", ts: 1720000000 * 1000 });
    expect(useVisionOffRequestStore.getState().requests).toHaveLength(1);
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("dropped unknown event"));
    warn.mockRestore();
  });

  it.each([
    ["vision_looking", { looking: true }, "looking"],
    ["vision_describing", { looking: true }, "describing"]
  ])("maps %s to the %s phase and keeps looking true in the cache", async (action, detail, phase) => {
    useVisionPhaseStore.setState({ phase: "idle" });
    server.use(eventsHandler([{ events: [{ seq: 1, ts: 1, source: "vision", action, detail }], cursor: 1, boot: 100 }]));
    const { queryClient, wrapper } = visionClient(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    renderHook(() => useServerEventLog(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useVisionPhaseStore.getState().phase).toBe(phase);
    expect(queryClient.getQueryData<{ status: { looking: boolean } }>(["vision"])?.status.looking).toBe(true);
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("dropped unknown event"));
    warn.mockRestore();
  });

  it.each([
    ["ok", "done"],
    ["describe_timeout", "failed"]
  ])("maps a %s vision_result to the %s phase", async (outcome, phase) => {
    useVisionResultStore.setState({ results: [] });
    useVisionPhaseStore.setState({ phase: "describing" });
    server.use(
      eventsHandler([{ events: [{ seq: 3, ts: 1, source: "vision", action: "vision_result", detail: outcome }], cursor: 3, boot: 100 }])
    );
    const { wrapper } = visionClient(true);

    renderHook(() => useServerEventLog(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useVisionPhaseStore.getState().phase).toBe(phase);
  });

  it("records vision_result in the result store (outcome and server time only) and invalidates the vision query", async () => {
    useVisionResultStore.setState({ results: [] });
    const batch: EventLogResponse = {
      events: [{ seq: 7, ts: 1720000000, source: "vision", action: "vision_result", detail: "describe_timeout" }],
      cursor: 7,
      boot: 100
    };
    server.use(eventsHandler([batch]));
    const { queryClient, wrapper } = visionClient(true);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useServerEventLog(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useVisionResultStore.getState().results).toEqual([
      { id: "srv-7", ts: 1720000000 * 1000, outcome: "describe_timeout", describeMs: null }
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["vision"] });
    expect(useEventStore.getState().events).toHaveLength(0);
  });

  it("reads the look id and frame count from GET /api/vision last_result when vision_result arrives", async () => {
    useVisionResultStore.setState({ results: [] });
    server.use(
      http.get(`${API_BASE_URL}/api/vision`, () =>
        HttpResponse.json({
          enabled: true,
          status: {
            daemon_state: "running",
            armed: false,
            looking: false,
            state: "ready",
            last_result: { id: "look-42", outcome: "ok", capture_ms: 40, describe_ms: 2900, frames_sent: 3, at: "now" }
          }
        })
      ),
      eventsHandler([
        { events: [{ seq: 9, ts: 1720000000, source: "vision", action: "vision_result", detail: "ok" }], cursor: 9, boot: 100 }
      ])
    );
    const { wrapper } = visionClient(true);

    renderHook(() => useServerEventLog(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(50));

    expect(useVisionResultStore.getState().results[0]).toMatchObject({ describeMs: 2900, lookId: "look-42", framesSent: 3 });
  });

  it("uses the vision_result payload directly and keeps it when the follow-up GET fails", async () => {
    useVisionResultStore.setState({ results: [] });
    server.use(
      http.get(`${API_BASE_URL}/api/vision`, () => new HttpResponse(null, { status: 500 })),
      eventsHandler([
        {
          events: [
            {
              seq: 11,
              ts: 1720000000,
              source: "vision",
              action: "vision_result",
              detail: { outcome: "ok", id: "look-77", describe_ms: 3900, frames_sent: 6, mode: "clip" }
            }
          ],
          cursor: 11,
          boot: 100
        }
      ])
    );
    const { wrapper } = visionClient(true);

    renderHook(() => useServerEventLog(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(50));

    expect(useVisionResultStore.getState().results[0]).toMatchObject({
      outcome: "ok",
      lookId: "look-77",
      describeMs: 3900,
      framesSent: 6,
      mode: "clip"
    });
    expect(useVisionPhaseStore.getState().phase).toBe("done");
  });

  it("fills only the missing fields from GET /api/vision when the payload is partial", async () => {
    useVisionResultStore.setState({ results: [] });
    server.use(
      http.get(`${API_BASE_URL}/api/vision`, () =>
        HttpResponse.json({
          enabled: true,
          status: {
            daemon_state: "running",
            armed: false,
            looking: false,
            state: "ready",
            last_result: { id: "look-from-get", outcome: "ok", capture_ms: 1, describe_ms: 1111, frames_sent: 2, mode: "text", at: "now" }
          }
        })
      ),
      eventsHandler([
        {
          events: [{ seq: 12, ts: 1720000000, source: "vision", action: "vision_result", detail: { outcome: "ok", id: "look-payload", mode: "clip" } }],
          cursor: 12,
          boot: 100
        }
      ])
    );
    const { wrapper } = visionClient(true);

    renderHook(() => useServerEventLog(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(50));

    expect(useVisionResultStore.getState().results[0]).toMatchObject({
      lookId: "look-payload",
      mode: "clip",
      describeMs: 1111,
      framesSent: 2
    });
  });
});
