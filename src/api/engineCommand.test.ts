import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  commandConflictHandler,
  commandNetworkErrorHandler,
  commandQueueFullHandler,
  commandValidationHandler,
  evolvingCurrentModelHandler,
  frozenStatusHandler,
  neverConvergesStatusHandler
} from "../test/handlers.js";
import { useEngineCommand } from "./engineCommand.js";
import { MODELS_QUERY_KEY } from "./models.js";
import { STATUS_QUERY_KEY } from "./status.js";
import { TTS_CONFIG_QUERY_KEY } from "./tts.js";
import type { StatusResponse } from "./client.js";
import { useEventStore } from "../store/eventStore.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Same as createWrapper, but also hands back the QueryClient instance so a
 * test can spy on invalidateQueries. */
function createWrapperWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useEngineCommand optimistic convergence (no matches predicate — tier/voice/speed/local_only/engine/clear)", () => {
  it("dispatches with an Idempotency-Key, disables (pending) after accept, and converges WITHOUT state_version ever advancing", async () => {
    // GET /api/status is pinned at the SAME state_version the accept
    // response returns — exactly how the real single-dispatcher counter
    // behaves (it never advances again just because the engine applied the
    // command). If the old `state_version > baseline` comparison were ever
    // reintroduced in place of the optimistic timer, `pending` would stay
    // true forever here and this test would time out and fail.
    server.use(frozenStatusHandler(1));
    let capturedHeader: string | null = null;
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedHeader = request.headers.get("Idempotency-Key");
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 1 });
      })
    );

    const { result } = renderHook(() => useEngineCommand(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("switch_llm_tier", "quality");
    });

    expect(capturedHeader).not.toBeNull();
    expect(capturedBody).toEqual({ command: "switch_llm_tier", payload: { value: "quality" } });
    expect(result.current.pending).toBe(true);
    expect(result.current.isTimeout).toBe(false);

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.isTimeout).toBe(false);
  });
});

describe("useEngineCommand custom convergence (e.g. switch_model -> current_model)", () => {
  it("converges as soon as the matches() predicate is true, even though state_version never advances", async () => {
    server.use(evolvingCurrentModelHandler("qwen3-tts", "gemma4:e4b", 1));
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-2", status: "queued", state_version: 1 })
      )
    );

    const matches = (status: StatusResponse, value: unknown) => status.current_model === value;
    const { result } = renderHook(() => useEngineCommand(matches), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("switch_model", "gemma4:e4b");
    });
    expect(result.current.pending).toBe(true);

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.isTimeout).toBe(false);
  });

  it("times out after APPLY_TIMEOUT_MS when current_model never flips, clearing pending instead of disabling forever", async () => {
    vi.useFakeTimers();
    server.use(neverConvergesStatusHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-stuck", status: "queued", state_version: 1 })
      )
    );

    const matches = (status: StatusResponse, value: unknown) => status.current_model === value;
    const { result } = renderHook(() => useEngineCommand(matches), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("switch_model", "gemma4:e4b");
      await vi.advanceTimersByTimeAsync(0); // flush the accept fetch under fake timers
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.isTimeout).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(15000));

    expect(result.current.pending).toBe(false);
    expect(result.current.isTimeout).toBe(true);
  });
});

describe("useEngineCommand model-list invalidation (S5)", () => {
  it("invalidates MODELS_QUERY_KEY alongside STATUS_QUERY_KEY after a successful switch_model run, so ModelCard doesn't stay stale", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-models", status: "queued", state_version: 1 })
      )
    );

    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useEngineCommand(), { wrapper });

    await act(async () => {
      await result.current.run("switch_model", "gemma4:e4b");
    });

    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: MODELS_QUERY_KEY }));
  });
});

describe("useEngineCommand error surfacing", () => {
  it("surfaces a 409 conflict honestly and clears pending", async () => {
    server.use(commandConflictHandler());
    const { result } = renderHook(() => useEngineCommand(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("switch_model", "x").catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toMatchObject({ status: 409 });
  });

  it("surfaces a 429 queue_full honestly and clears pending", async () => {
    server.use(commandQueueFullHandler());
    const { result } = renderHook(() => useEngineCommand(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("switch_model", "x").catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toMatchObject({ status: 429 });
  });

  it("surfaces a 422 validation error honestly with the backend detail", async () => {
    server.use(commandValidationHandler("set_tts_speed requires a numeric value"));
    const { result } = renderHook(() => useEngineCommand(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("set_tts_speed", null).catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      status: 422,
      message: "set_tts_speed requires a numeric value"
    });
  });

  it("surfaces a network error honestly", async () => {
    server.use(commandNetworkErrorHandler());
    const { result } = renderHook(() => useEngineCommand(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("switch_model", "x").catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.pending).toBe(false);
  });
});

describe("useEngineCommand idempotency key registry reuse", () => {
  it("reuses a stable Idempotency-Key per (command,value) intent across retries", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        seen.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({ accepted: true, command_id: "cmd-3", status: "queued", state_version: 1 });
      })
    );

    const { result } = renderHook(() => useEngineCommand(), { wrapper: createWrapper() });

    // Fake timers freeze the optimistic 400ms convergence timer, so both
    // dispatches definitely land before the first one converges and rotates
    // the key — deterministic, no reliance on real wall-clock speed.
    await act(async () => {
      await result.current.run("switch_llm_tier", "quality");
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.run("switch_llm_tier", "quality");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toBe("");
  });

  it("clear_history uses a stable key with no payload value", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-4", status: "queued", state_version: 1 });
      })
    );

    const { result } = renderHook(() => useEngineCommand(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("clear_history");
    });

    expect(capturedBody).toEqual({ command: "clear_history", payload: {} });
  });
});

describe("useEngineCommand immediate failure event resolution (model_switch_failed, llm_tier_switch_failed)", () => {
  it("resolves pending to false immediately and sets isFailed: true without waiting for timeout when failure event is received", async () => {
    vi.useFakeTimers();
    server.use(neverConvergesStatusHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-failed", status: "queued", state_version: 1 })
      )
    );

    const matches = (status: StatusResponse, value: unknown) => status.current_model === value;
    const { result } = renderHook(() => useEngineCommand(matches), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.run("switch_model", "gemma4:e4b");
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.isFailed).toBe(false);
    expect(result.current.isTimeout).toBe(false);

    // Emit failure event via useEventStore using protocol action
    act(() => {
      useEventStore.getState().append({
        id: "evt-failed-1",
        ts: Date.now(),
        source: "motor",
        action: "model_switch_failed",
        label: "Fallo al cambiar modelo",
        tone: "danger"
      });
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.isFailed).toBe(true);
    expect(result.current.isTimeout).toBe(false);
  });
});

describe("useEngineCommand settled invalidation and rollback signals", () => {
  it("invalidates STATUS, MODELS, and TTS_CONFIG on command error when manualConvergence is false", async () => {
    server.use(commandConflictHandler());
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const onError = vi.fn();

    const { result } = renderHook(() => useEngineCommand(undefined, { onError }), { wrapper });

    let runResult: unknown = "unset";
    await act(async () => {
      runResult = await result.current.run("set_piper_voice", "neutral");
    });

    expect(runResult).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: STATUS_QUERY_KEY }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: MODELS_QUERY_KEY }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: TTS_CONFIG_QUERY_KEY }));
  });

  it("does not invalidate TTS_CONFIG in onSettled when manualConvergence is true", async () => {
    server.use(commandConflictHandler());
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useEngineCommand(undefined, { manualConvergence: true }),
      { wrapper }
    );

    await act(async () => {
      await result.current.run("set_tts_local_only", false);
    });

    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: STATUS_QUERY_KEY }));
    expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: TTS_CONFIG_QUERY_KEY }));
  });

  it("invokes onTimeout when a post-accept command times out and when a stalled POST times out", async () => {
    vi.useFakeTimers();
    server.use(neverConvergesStatusHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-timeout", status: "queued", state_version: 1 })
      )
    );

    const onTimeout = vi.fn();
    const matches = (status: StatusResponse, value: unknown) => status.current_model === value;
    const { result } = renderHook(() => useEngineCommand(matches, { onTimeout }), {
      wrapper: createWrapper()
    });

    await act(async () => {
      await result.current.run("switch_model", "gemma4:e4b");
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => vi.advanceTimersByTimeAsync(15000));

    expect(result.current.isTimeout).toBe(true);
    expect(result.current.pending).toBe(false);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled POST /api/commands request on default non-manual commands and calls onError + onTimeout", async () => {
    vi.useFakeTimers();
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () => new Promise(() => {}))
    );

    const onError = vi.fn();
    const onTimeout = vi.fn();
    const { result } = renderHook(() => useEngineCommand(undefined, { onError, onTimeout }), {
      wrapper: createWrapper()
    });

    let settled = false;
    let runPromise!: Promise<unknown>;
    await act(async () => {
      runPromise = result.current.run("set_piper_voice", "neutral").then((res) => {
        settled = true;
        return res;
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.pending).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(15000));
    const runResult = await runPromise;

    expect(settled).toBe(true);
    expect(runResult).toBeUndefined();
    expect(result.current.pending).toBe(false);
    expect(result.current.isError).toBe(true);
    expect(result.current.isTimeout).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("invokes onFailed when a failure event resolves pending state", async () => {
    vi.useFakeTimers();
    server.use(neverConvergesStatusHandler());
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-fail-cb", status: "queued", state_version: 1 })
      )
    );

    const onFailed = vi.fn();
    const matches = (status: StatusResponse, value: unknown) => status.current_model === value;
    const { result } = renderHook(() => useEngineCommand(matches, { onFailed }), {
      wrapper: createWrapper()
    });

    await act(async () => {
      await result.current.run("switch_model", "gemma4:e4b");
    });

    act(() => {
      useEventStore.getState().append({
        id: "evt-failed-cb",
        ts: Date.now(),
        source: "motor",
        action: "model_switch_failed",
        label: "Fallo al cambiar modelo",
        tone: "danger"
      });
    });

    expect(result.current.isFailed).toBe(true);
    expect(result.current.pending).toBe(false);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });
});
