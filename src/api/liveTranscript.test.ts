import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { useEventStore } from "../store/eventStore.js";
import { appendSegment, finalizeTranscript, useLiveTranscript } from "./liveTranscript.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Recv-only double for the browser WebSocket — records the dialed URL,
 * lets tests push frames through onmessage, and tracks close(). */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const WS_URL = "ws://127.0.0.1:8765";

/** Mutable /api/ptt/state script: tests flip `current` and advance the 1s
 * poll — the same fake-timers + msw pattern as ptt.test.ts's flush poll. */
let current: Record<string, unknown>;

function pttState(state: string, sttWsUrl: string | null = WS_URL): Record<string, unknown> {
  return { state, session_id: state === "idle" ? null : "ptt_x", buffered_chars: 0, last_error: null, stt_ws_url: sttWsUrl };
}

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  current = pttState("idle");
  // Module singleton — the per-hold stamp below reads the server `ptt.*` echoes
  // out of it, so every test starts with an empty feed.
  useEventStore.setState({ events: [] });
  server.use(http.get(`${API_BASE_URL}/api/ptt/state`, () => HttpResponse.json(current)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function tick(ms = 1000) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** One observed poll cycle: the 1s interval fires the refetch in the first
 * advance window, the response lands in the second (msw under fake timers
 * delivers one window late — verified against ptt.test.ts's own cadence). */
async function pollTick() {
  await tick();
  await tick();
}

describe("useLiveTranscript: lifecycle", () => {
  it("connects on listening, accumulates final segments, resolves ONCE on idle, disconnects", async () => {
    const onTranscript = vi.fn();
    renderHook(() => useLiveTranscript(onTranscript), { wrapper: createWrapper() });

    await tick(0); // initial poll: idle
    expect(MockWebSocket.instances).toHaveLength(0);

    current = pttState("listening");
    await pollTick(); // poll sees the hold -> dials LiveAudio
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe(WS_URL);

    act(() => {
      ws.emit(JSON.stringify({ type: "hello", app: "liveaudio", proto: 1, port: 8765 })); // no text -> ignored
      ws.emit(JSON.stringify({ id: "u1", text: "probando el eco" }));
    });

    current = pttState("flushing");
    await pollTick(); // release: grace window — socket must STAY open
    expect(ws.closed).toBe(false);
    act(() => {
      ws.emit(JSON.stringify({ id: "u2", text: "de voz" })); // grace-window segment still lands
    });

    current = pttState("idle");
    await pollTick(); // backend flushed -> resolve + disconnect
    expect(onTranscript).toHaveBeenCalledTimes(1);
    // Second arg: this hold's borrowable server stamp — 0 here, no ptt echo was
    // ever polled (see the per-hold stamp describe below).
    expect(onTranscript).toHaveBeenCalledWith("probando el eco de voz", 0);
    expect(ws.closed).toBe(true);

    await pollTick(); // still idle: no re-fire, no re-dial
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("under two words resolves nothing — mirrors the backend's empty flush", async () => {
    const onTranscript = vi.fn();
    renderHook(() => useLiveTranscript(onTranscript), { wrapper: createWrapper() });
    await tick(0);

    current = pttState("listening");
    await pollTick();
    const ws = MockWebSocket.instances[0];
    act(() => ws.emit(JSON.stringify({ text: "hola" })));

    current = pttState("idle");
    await pollTick();
    expect(ws.closed).toBe(true); // idle transition WAS observed…
    expect(onTranscript).not.toHaveBeenCalled(); // …and still no echo
  });

  it("degrades silently when the WS constructor refuses — no crash, no echo, ONE attempt per hold", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          attempts += 1;
          throw new Error("connect refused");
        }
      }
    );
    const onTranscript = vi.fn();
    renderHook(() => useLiveTranscript(onTranscript), { wrapper: createWrapper() });
    await tick(0);

    current = pttState("listening");
    await pollTick();
    await pollTick(); // more polls while held must not re-dial (attempted flag)
    expect(attempts).toBe(1);

    current = pttState("idle");
    await pollTick();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("degrades silently when the backend exposes no stt_ws_url (older API)", async () => {
    const onTranscript = vi.fn();
    renderHook(() => useLiveTranscript(onTranscript), { wrapper: createWrapper() });
    await tick(0);

    current = pttState("listening", null);
    await pollTick();
    expect(MockWebSocket.instances).toHaveLength(0);

    current = pttState("idle", null);
    await pollTick();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("closes the socket on unmount without echoing", async () => {
    const onTranscript = vi.fn();
    const { unmount } = renderHook(() => useLiveTranscript(onTranscript), { wrapper: createWrapper() });
    await tick(0);

    current = pttState("listening");
    await pollTick();
    const ws = MockWebSocket.instances[0];
    act(() => ws.emit(JSON.stringify({ text: "no me muestres esto" })));

    unmount();
    expect(ws.closed).toBe(true);
    expect(onTranscript).not.toHaveBeenCalled();
  });
});

/**
 * Per-hold ptt stamp (feed-inversion fix). The voice channel has NO server clock
 * of its own — the words never cross the OpenCohost HTTP API — so a voice turn
 * borrows the newest server `ptt.*` echo as its sort key. But this hook's
 * GET /api/ptt/state poll (1s) and the GET /api/events poll (1.5s) are
 * INDEPENDENT queries, throttled unevenly while a WebView2 window sits behind a
 * game: at echo time the newest ptt row in the store can still be the PREVIOUS
 * hold's. A running maximum accepts exactly that stale row and stamps the second
 * spoken turn ABOVE the answer to the first.
 *
 * So the invariant is per-hold, not monotonic: snapshot the newest ptt ts at the
 * hold's RISING EDGE as a baseline, and hand the consumer a stamp only when the
 * newest ts at the echo is strictly GREATER — i.e. that reading demonstrably
 * arrived while this hold was live. Otherwise hand over 0, meaning "nothing
 * borrowable, use arrival time".
 */
describe("useLiveTranscript: per-hold ptt stamp", () => {
  // Server-clock readings for one hold pair. ptt.auto_stopped/flushed/empty are
  // KNOWN_SILENT (src/lib/appEvents.ts), so a watchdog-terminated hold leaves
  // ONLY `ptt.started` behind — that is the single-reading case below.
  const T_STARTED_H1 = 1_000_000;
  const T_STOPPED_H1 = 1_030_000;

  function appendPtt(id: string, ts: number) {
    useEventStore.getState().append({ id, ts, source: "ptt", label: "PTT enviado a Kira", tone: "ok" });
  }

  /** One full hold: listening -> (optional mid-hold poll arrival) -> idle. */
  async function hold(text: string, arrivesDuringHold?: () => void) {
    current = pttState("listening");
    await pollTick();
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => ws.emit(JSON.stringify({ text })));
    arrivesDuringHold?.();
    current = pttState("idle");
    await pollTick();
  }

  it("borrows the ONLY reading a watchdog-terminated hold leaves (ptt.started), which arrived during the hold", async () => {
    const onTranscript = vi.fn();
    renderHook(() => useLiveTranscript(onTranscript), { wrapper: createWrapper() });
    await tick(0);

    await hold("primer turno de voz", () => appendPtt("srv-started-h1", T_STARTED_H1));

    expect(onTranscript).toHaveBeenCalledWith("primer turno de voz", T_STARTED_H1);
  });

  it("hands over 0 for a second hold whose newest visible ptt row predates its rising edge", async () => {
    const onTranscript = vi.fn();
    renderHook(() => useLiveTranscript(onTranscript), { wrapper: createWrapper() });
    await tick(0);

    // Hold 1 borrows its own started(h1), the only row polled so far.
    await hold("primer turno de voz", () => appendPtt("srv-started-h1", T_STARTED_H1));
    expect(onTranscript).toHaveBeenNthCalledWith(1, "primer turno de voz", T_STARTED_H1);

    // stopped(h1) is polled only BETWEEN the holds, so it is hold 2's baseline —
    // never hold 2's stamp. A running maximum would hand it over (it is greater
    // than the T_STARTED_H1 already used) and sort hold 2 above Kira's answer to
    // hold 1, which sits between the two readings.
    appendPtt("srv-stopped-h1", T_STOPPED_H1);
    await hold("segundo turno de voz");

    expect(onTranscript).toHaveBeenNthCalledWith(2, "segundo turno de voz", 0);
  });

  it("zero-baseline hold: nothing polled during hold 1, and hold 2 still cannot borrow the stale row", async () => {
    const onTranscript = vi.fn();
    renderHook(() => useLiveTranscript(onTranscript), { wrapper: createWrapper() });
    await tick(0);

    // Hold 1 echoes before ANY ptt row has been polled: nothing to borrow.
    await hold("primer turno de voz");
    expect(onTranscript).toHaveBeenNthCalledWith(1, "primer turno de voz", 0);

    // stopped(h1) lands late — minutes stale by hold 2's rising edge. The running
    // maximum left its ref at 0 in this exact case, so hold 2 borrowed this stale
    // reading and sorted far above hold 1's own bubble.
    appendPtt("srv-stopped-h1", T_STOPPED_H1);
    await hold("segundo turno de voz");

    expect(onTranscript).toHaveBeenNthCalledWith(2, "segundo turno de voz", 0);
  });
});

describe("appendSegment / finalizeTranscript: LiveAudio frame parsing", () => {
  it("joins utterances with a space and ignores hello/theme/malformed frames", () => {
    let buf = "";
    buf = appendSegment(buf, JSON.stringify({ type: "hello", app: "liveaudio", proto: 1 }));
    buf = appendSegment(buf, JSON.stringify({ text: "primera frase" }));
    buf = appendSegment(buf, JSON.stringify({ type: "theme", tokens: { accent: "#0ff" } }));
    buf = appendSegment(buf, "not json at all");
    buf = appendSegment(buf, JSON.stringify({ text: "  segunda  " }));
    buf = appendSegment(buf, JSON.stringify({ text: "" }));
    buf = appendSegment(buf, 42);
    expect(buf).toBe("primera frase segunda");
  });

  it("collapses 3+ stutter repeats like the backend anti-loop filter", () => {
    expect(appendSegment("", JSON.stringify({ text: "hola hola hola que tal" }))).toBe("hola que tal");
  });

  it("stops appending past the 2000-char soft cap", () => {
    const base = "x".repeat(2000);
    expect(appendSegment(base, JSON.stringify({ text: "extra" }))).toBe(base);
  });

  it("finalize: >= 2 words passes trimmed, fewer resolves empty", () => {
    expect(finalizeTranscript("  hola kira  ")).toBe("hola kira");
    expect(finalizeTranscript("hola")).toBe("");
    expect(finalizeTranscript("   ")).toBe("");
    expect(finalizeTranscript("")).toBe("");
  });
});
