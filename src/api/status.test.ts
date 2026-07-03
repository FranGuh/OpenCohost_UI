import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus, evolvingStatusHandler } from "../test/handlers.js";
import { useSwitchStore } from "../store/switchStore.js";
import { useStatusQuery, usePollUntilApplied } from "./status.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function countingStatusHandler(onCall: (calls: number) => void) {
  let calls = 0;
  return http.get(`${API_BASE_URL}/api/status`, () => {
    calls += 1;
    onCall(calls);
    return HttpResponse.json(defaultStatus);
  });
}

/** Mirrors the real usage pattern (Slice B): target is re-derived from the
 * store on every render, so it naturally becomes `null` once convergence
 * clears `pendingSwitch` — which should cancel any pending soft timeout. */
function useDerivedPoll() {
  const pendingSwitch = useSwitchStore((state) => state.pendingSwitch);
  return usePollUntilApplied(pendingSwitch?.name ?? null);
}

beforeEach(() => {
  vi.useFakeTimers();
  useSwitchStore.setState({ pendingSwitch: null });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("useStatusQuery polling cadence (spec R3)", () => {
  it("fetches a new status approximately every 2s while focused", async () => {
    let calls = 0;
    server.use(countingStatusHandler((n) => (calls = n)));

    renderHook(() => useStatusQuery(), { wrapper: createWrapper() });

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(calls).toBe(2);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(calls).toBe(3);
  });

  it("does not poll while the window is backgrounded (refetchIntervalInBackground:false)", async () => {
    let calls = 0;
    server.use(countingStatusHandler((n) => (calls = n)));

    renderHook(() => useStatusQuery(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toBe(1);

    focusManager.setFocused(false);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(calls).toBe(1);
  });
});

describe("usePollUntilApplied (spec R5 poll-transition)", () => {
  it("stays applying while a poll returns the OLD active_profile, clears only when it matches target", async () => {
    server.use(evolvingStatusHandler("default", "Akira", 2));
    useSwitchStore.getState().setPending({ name: "Akira", commandId: "cmd-1", status: "applying" });

    const { result } = renderHook(() => usePollUntilApplied("Akira"), { wrapper: createWrapper() });

    // Trigger polls deterministically via refetch() instead of relying on
    // exact fake-timer/interval alignment (cadence itself is covered above).
    // The extra advanceTimersByTimeAsync(0) flushes MSW/fetch continuations
    // that fake timers otherwise stall.
    await act(() => vi.advanceTimersByTimeAsync(0)); // poll 1: old
    expect(useSwitchStore.getState().pendingSwitch).not.toBeNull();

    await act(async () => {
      await result.current.refetch(); // poll 2: old
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useSwitchStore.getState().pendingSwitch).not.toBeNull();

    await act(async () => {
      await result.current.refetch(); // poll 3: flips to target
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });
});

describe("usePollUntilApplied soft timeout (F2 / design D6)", () => {
  it("transitions pendingSwitch to a terminal 'timeout' state after ~15s without convergence", async () => {
    // Default GET /api/status handler always reports active_profile:"default"
    // — target "Akira" never converges.
    useSwitchStore.getState().setPending({ name: "Akira", commandId: "cmd-1", status: "applying" });

    renderHook(() => useDerivedPoll(), { wrapper: createWrapper() });

    await act(() => vi.advanceTimersByTimeAsync(15000));

    expect(useSwitchStore.getState().pendingSwitch).toEqual({
      name: "Akira",
      commandId: "cmd-1",
      status: "timeout"
    });
  });

  it("does not transition to timeout when convergence happens before the soft timeout", async () => {
    server.use(evolvingStatusHandler("default", "Akira", 1));
    useSwitchStore.getState().setPending({ name: "Akira", commandId: "cmd-1", status: "applying" });

    const { result } = renderHook(() => useDerivedPoll(), { wrapper: createWrapper() });

    await act(() => vi.advanceTimersByTimeAsync(0)); // poll 1: old
    await act(async () => {
      await result.current.refetch(); // poll 2: flips to target
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useSwitchStore.getState().pendingSwitch).toBeNull();

    // Well past the soft timeout — must stay converged/null, not resurrect
    // into a "timeout" state.
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });
});
