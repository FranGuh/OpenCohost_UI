import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
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
    expect(onTranscript).toHaveBeenCalledWith("probando el eco de voz");
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
