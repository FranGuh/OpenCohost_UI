import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  defaultPttStart,
  pttKeepaliveNetworkErrorHandler,
  pttKeepaliveNotActiveHandler,
  pttSessionFlowHandlers,
  pttStartConflictHandler,
  pttStartUnreachableHandler
} from "../test/handlers.js";
import { usePttHold } from "./ptt.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Counts POSTs to a given /api/ptt/* path while still answering with
 * `response` — same spy-handler pattern as memoriaRowSpyHandler. */
function countingHandler<T extends object>(path: string, response: T) {
  const counter = { calls: 0 };
  const handler = http.post(`${API_BASE_URL}${path}`, () => {
    counter.calls += 1;
    return HttpResponse.json(response);
  });
  return { counter, handler };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("usePttHold: start", () => {
  it("goes idle -> connecting -> listening only after the 200, never optimistically", async () => {
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });
    expect(result.current.state).toBe("idle");

    act(() => result.current.start());
    expect(result.current.state).toBe("connecting"); // not "listening" yet — no fake state

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("listening");
    expect(result.current.error).toBeNull();
  });

  it("503 stt_unreachable: stays idle, never listening, surfaces the error code", async () => {
    server.use(pttStartUnreachableHandler());
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe("stt_unreachable");
  });

  it("409 session_active: stays idle with a start_failed error", async () => {
    server.use(pttStartConflictHandler());
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe("start_failed");
  });

  it("ignores a second start() call while already connecting/listening", async () => {
    const { counter, handler } = countingHandler("/api/ptt/start", defaultPttStart);
    server.use(handler);
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.start());
    act(() => result.current.start()); // duplicate pointerdown/keydown race
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("listening");

    act(() => result.current.start()); // already listening — still ignored
    expect(counter.calls).toBe(1);
  });
});

describe("usePttHold: keepalive", () => {
  it("posts a keepalive every 1000ms while listening", async () => {
    const { counter, handler } = countingHandler("/api/ptt/keepalive", {
      session_id: defaultPttStart.session_id,
      state: "listening",
      buffered_chars: 5
    });
    server.use(handler);
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("listening");
    expect(counter.calls).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(counter.calls).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(counter.calls).toBe(2);
  });

  it("409 (server guillotined the session): drops to idle with session_not_active and stops polling", async () => {
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });
    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("listening");

    server.use(pttKeepaliveNotActiveHandler());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe("session_not_active");

    // Registered only now (after the 409 already landed) — proves polling
    // actually stopped instead of accidentally shadowing pttKeepaliveNotActiveHandler above.
    const { counter, handler } = countingHandler("/api/ptt/keepalive", {});
    server.use(handler);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(counter.calls).toBe(0); // interval was cleared, not still ticking
  });

  it("network error: clears the interval and surfaces stt_lost (watchdog finishes server-side)", async () => {
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });
    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("listening");

    server.use(pttKeepaliveNetworkErrorHandler());
    await act(() => vi.advanceTimersByTimeAsync(1000));

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBe("stt_lost");
  });
});

describe("usePttHold: stop", () => {
  it("release clears the keepalive interval and posts stop exactly once", async () => {
    const { counter: stopCounter, handler: stopHandler } = countingHandler("/api/ptt/stop", { state: "flushing" });
    server.use(stopHandler);

    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });
    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("listening");

    act(() => result.current.stop());
    expect(result.current.state).toBe("flushing");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(stopCounter.calls).toBe(1);

    const { counter: keepaliveCounter, handler: keepaliveHandler } = countingHandler("/api/ptt/keepalive", {});
    server.use(keepaliveHandler);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(keepaliveCounter.calls).toBe(0); // interval was cleared on stop, not still ticking
  });

  it("polls GET /api/ptt/state at 1s while flushing and converges to idle", async () => {
    server.use(...pttSessionFlowHandlers(2));
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("listening");

    act(() => result.current.stop());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("flushing");

    await act(() => vi.advanceTimersByTimeAsync(1000)); // poll 1: still flushing
    expect(result.current.state).toBe("flushing");

    await act(() => vi.advanceTimersByTimeAsync(1000)); // poll 2: converges to idle
    expect(result.current.state).toBe("idle");
  });

  it("ignores stop() while already idle", async () => {
    const { counter, handler } = countingHandler("/api/ptt/stop", { state: "idle" });
    server.use(handler);
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.stop());
    expect(counter.calls).toBe(0);
  });
});

describe("usePttHold: fast-tap race", () => {
  it("stop() during connecting cuts the session the instant start() resolves, never shows listening", async () => {
    let resolveStart!: () => void;
    let stopBody: unknown;
    server.use(
      http.post(
        `${API_BASE_URL}/api/ptt/start`,
        () =>
          new Promise((resolve) => {
            resolveStart = () => resolve(HttpResponse.json(defaultPttStart));
          })
      ),
      http.post(`${API_BASE_URL}/api/ptt/stop`, async ({ request }) => {
        stopBody = await request.json();
        return HttpResponse.json({ state: "flushing" });
      }),
      // Stays "flushing" throughout — otherwise the flush-poll (enabled the
      // instant state becomes "flushing") would immediately converge to the
      // GET default's idle and mask the assertion this test cares about.
      http.get(`${API_BASE_URL}/api/ptt/state`, () =>
        HttpResponse.json({ state: "flushing", session_id: null, buffered_chars: 0, last_error: null })
      )
    );
    const { result } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.start());
    expect(result.current.state).toBe("connecting");

    act(() => result.current.stop()); // released before start() ever resolved
    expect(result.current.state).toBe("flushing");
    await act(() => vi.advanceTimersByTimeAsync(0));
    // stop() fired with no session id yet (start() hasn't resolved) — the
    // idempotent "stop whatever is active" path.
    expect(stopBody).toEqual({});

    await act(async () => {
      resolveStart();
      await vi.advanceTimersByTimeAsync(0);
    });

    // start()'s success landed AFTER we already moved to flushing — must not
    // resurrect "listening"; the just-opened session gets cut directly.
    expect(result.current.state).toBe("flushing");
  });
});

describe("usePttHold: unmount safety net", () => {
  it("never leaves a session open — posts stop on unmount while listening", async () => {
    const { counter, handler } = countingHandler("/api/ptt/stop", { state: "flushing" });
    server.use(handler);
    const { result, unmount } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("listening");

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(counter.calls).toBe(1);

    const { counter: keepaliveCounter, handler: keepaliveHandler } = countingHandler("/api/ptt/keepalive", {});
    server.use(keepaliveHandler);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(keepaliveCounter.calls).toBe(0); // interval was cleared, not leaking after unmount
  });

  it("posts stop on unmount even mid-connect (start() still in flight)", async () => {
    let resolveStart!: () => void;
    const { counter, handler } = countingHandler("/api/ptt/stop", { state: "idle" });
    server.use(
      http.post(
        `${API_BASE_URL}/api/ptt/start`,
        () =>
          new Promise((resolve) => {
            resolveStart = () => resolve(HttpResponse.json(defaultPttStart));
          })
      ),
      handler
    );
    const { result, unmount } = renderHook(() => usePttHold(), { wrapper: createWrapper() });

    act(() => result.current.start());
    expect(result.current.state).toBe("connecting");

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(counter.calls).toBe(1); // stop() fires immediately, without a session id

    await act(async () => {
      resolveStart();
      await vi.advanceTimersByTimeAsync(0);
    });
  });
});
