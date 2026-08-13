import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  defaultStreamChatLive,
  streamChatLiveUnavailableHandler,
  streamConnectBusyHandler,
  streamConnectInvalidUrlHandler,
  streamLimitsValidationHandler
} from "../test/handlers.js";
import { selectStreamChatMessages, useStreamChatStore } from "../store/streamChatStore.js";
import {
  StreamConnectTimeoutError,
  connectStreamAndAwait,
  getStreamChatMessages,
  useStreamChatLiveQuery,
  useStreamChatMessages,
  useStreamConnectMutation,
  useStreamDisconnectMutation,
  useStreamLimitsMutation
} from "./stream.js";
import { ApiError, ConflictError, ValidationError, setApiToken } from "./client.js";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

const noSleep = async () => {};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useStreamChatLiveQuery", () => {
  it("reads connection state + limits from GET /api/stream/chat-live", async () => {
    const { result } = renderHook(() => useStreamChatLiveQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultStreamChatLive));
  });

  it("surfaces stream_unavailable (503) honestly instead of faking state", async () => {
    server.use(streamChatLiveUnavailableHandler());
    const { result } = renderHook(() => useStreamChatLiveQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("never exposes any viewer-chat-text-shaped field on the response", async () => {
    const { result } = renderHook(() => useStreamChatLiveQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const keys = Object.keys(result.current.data as object);
    expect(keys).toEqual([
      "connected",
      "platform",
      "source_id",
      "threshold_per_second",
      "cooldown_seconds",
      "max_messages_per_user",
      "filter_policy",
      "input_contract",
      "stream_over_agenda",
      "stream_ttl_seconds",
      "effective_stream_ttl_seconds"
    ]);
  });
});

describe("useStreamConnectMutation", () => {
  it("fires POST /api/stream/chat-live/connect and reflects the returned connected state", async () => {
    const { result } = renderHook(() => useStreamConnectMutation(), { wrapper: createWrapper() });
    result.current.mutate("https://twitch.tv/kira");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.connected).toBe(true);
  });

  it("throws ValidationError on 422 invalid_url", async () => {
    server.use(streamConnectInvalidUrlHandler());
    const { result } = renderHook(() => useStreamConnectMutation(), { wrapper: createWrapper() });
    result.current.mutate("not-a-url");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ValidationError);
  });

  it("throws ConflictError on 409 busy", async () => {
    server.use(streamConnectBusyHandler());
    const { result } = renderHook(() => useStreamConnectMutation(), { wrapper: createWrapper() });
    result.current.mutate("https://twitch.tv/kira");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ConflictError);
  });

  it("throws ApiError(503, chat_source_unavailable) so the UI can name the missing connector", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () =>
        HttpResponse.json({ detail: "chat_source_unavailable" }, { status: 503 })
      )
    );
    const { result } = renderHook(() => useStreamConnectMutation(), { wrapper: createWrapper() });
    result.current.mutate("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(503);
    // R8/F4: the code — not a raw traceback string — so errorCopy can map it.
    expect((result.current.error as ApiError).message).toBe("chat_source_unavailable");
  });
});

describe("connectStreamAndAwait (Lote C — POST then poll GET status until connected)", () => {
  it("polls GET status and resolves once connected flips to true", async () => {
    // The real backend connects on a daemon thread, so the POST returns
    // connected:false a beat before the socket is actually up.
    server.use(
      http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, connected: false, platform: "youtube" })
      )
    );
    let statusCalls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () => {
        statusCalls += 1;
        return HttpResponse.json({
          ...defaultStreamChatLive,
          connected: statusCalls >= 2, // flips on the 2nd poll
          platform: "youtube",
          source_id: "vid12345678"
        });
      })
    );
    const result = await connectStreamAndAwait("youtube.com/watch?v=vid12345678", {
      intervalMs: 0,
      sleep: noSleep
    });
    expect(result.connected).toBe(true);
    expect(result.platform).toBe("youtube");
    expect(statusCalls).toBeGreaterThanOrEqual(2);
  });

  it("throws StreamConnectTimeoutError when the chat never reports connected", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, connected: false })
      )
    );
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, connected: false })
      )
    );
    await expect(
      connectStreamAndAwait("youtube.com/watch?v=vid12345678", { attempts: 3, intervalMs: 0, sleep: noSleep })
    ).rejects.toBeInstanceOf(StreamConnectTimeoutError);
  });

  it("resolves immediately (no poll) when the connect POST already reports connected", async () => {
    let statusCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, connected: true, platform: "twitch", source_id: "kira" })
      )
    );
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () => {
        statusCalls += 1;
        return HttpResponse.json(defaultStreamChatLive);
      })
    );
    const result = await connectStreamAndAwait("twitch.tv/kira", { intervalMs: 0, sleep: noSleep });
    expect(result.connected).toBe(true);
    expect(statusCalls).toBe(0);
  });

  it("propagates a 422 from the connect POST without polling (fast reject)", async () => {
    let statusCalls = 0;
    server.use(streamConnectInvalidUrlHandler());
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () => {
        statusCalls += 1;
        return HttpResponse.json(defaultStreamChatLive);
      })
    );
    await expect(
      connectStreamAndAwait("not-a-url", { attempts: 3, intervalMs: 0, sleep: noSleep })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(statusCalls).toBe(0);
  });
});

/**
 * Fix 8. `authFetch` re-mints the cached token on a 401 only, but this endpoint
 * answers 403 for a missing/stale operator token — so a token that is not yet
 * minted (the documented startup race: the token file appears AFTER Tauri
 * probes for it) used to pin the Stream tab in the forbidden state until the
 * whole app restarted.
 */
describe("getStreamChatMessages — a 403 must be recoverable without an app restart", () => {
  afterEach(() => {
    setApiToken(null);
    invokeMock.mockReset();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("re-bootstraps the operator token once on a 403 and retries the request with it", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValueOnce("minted-late");
    let attempts = 0;
    let retryHeader: string | null = null;
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, ({ request }) => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json({ detail: "operator_token_required" }, { status: 403 });
        }
        retryHeader = request.headers.get("Authorization");
        return HttpResponse.json({
          messages: [{ seq: 1, author: "viewer1", text: "hola", ts: 1 }],
          cursor: 1,
          boot: 1,
          session: 0,
          more_pending: false
        });
      })
    );

    const res = await getStreamChatMessages(0);

    expect(invokeMock).toHaveBeenCalledWith("api_token");
    expect(attempts).toBe(2);
    expect(retryHeader).toBe("Bearer minted-late");
    expect(res.messages).toHaveLength(1);
  });

  it("surfaces ApiError(403) after exactly ONE retry — never a loop", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValue("still-not-allowed");
    let attempts = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, () => {
        attempts += 1;
        return HttpResponse.json({ detail: "operator_token_required" }, { status: 403 });
      })
    );

    await expect(getStreamChatMessages(0)).rejects.toMatchObject({ name: "ApiError", status: 403 });
    expect(attempts).toBe(2);
  });

  it("outside the Tauri shell no token can be minted, so the request is never doubled", async () => {
    let attempts = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, () => {
        attempts += 1;
        return HttpResponse.json({ detail: "operator_token_required" }, { status: 403 });
      })
    );

    await expect(getStreamChatMessages(0)).rejects.toBeInstanceOf(ApiError);
    expect(attempts).toBe(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

/**
 * Fix 5. The server filters `seq > since` BEFORE this client can observe the
 * new `boot`, so carrying the stale cursor across a restart silently swallows
 * everything the new process buffered before the first post-restart poll.
 */
describe("useStreamChatMessages — cursor resync on a boot change", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStreamChatStore.setState({ messages: [], cursor: 0, boot: null, session: null, breaks: [], kiraReplies: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets `since` to 0 on a boot change instead of carrying the stale cursor", async () => {
    const sinces: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, ({ request }) => {
        const since = new URL(request.url).searchParams.get("since") ?? "";
        sinces.push(since);
        // Process 1.
        if (sinces.length === 1) {
          return HttpResponse.json({
            messages: [
              { seq: 1, author: "viewer1", text: "pre-1", ts: 1 },
              { seq: 2, author: "viewer1", text: "pre-2", ts: 2 }
            ],
            cursor: 2,
            boot: 1,
            session: 0,
            more_pending: false
          });
        }
        // Process 2 — its seq counter is back at 1, so a poll still carrying
        // the stale `since=2` is filtered down to NOTHING. This is what the
        // wire actually produces on a restart, and it is exactly the response
        // a client with no resync would keep receiving forever.
        if (since !== "0") {
          return HttpResponse.json({
            messages: [],
            cursor: Number(since),
            boot: 2,
            session: 0,
            more_pending: false
          });
        }
        return HttpResponse.json({
          messages: [
            { seq: 1, author: "viewer2", text: "post-1", ts: 3 },
            { seq: 2, author: "viewer2", text: "post-2", ts: 4 }
          ],
          cursor: 2,
          boot: 2,
          session: 0,
          more_pending: false
        });
      })
    );

    renderHook(() => useStreamChatMessages(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await act(() => vi.advanceTimersByTimeAsync(1600));

    expect(sinces.slice(0, 3)).toEqual(["0", "2", "0"]);
    expect(selectStreamChatMessages(useStreamChatStore.getState()).map((m) => m.text)).toEqual(["post-1", "post-2"]);
  });
});

describe("useStreamDisconnectMutation", () => {
  it("fires POST /api/stream/chat-live/disconnect and reflects connected:false", async () => {
    const { result } = renderHook(() => useStreamDisconnectMutation(), { wrapper: createWrapper() });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.connected).toBe(false);
  });
});

describe("useStreamLimitsMutation", () => {
  it("fires PUT /api/stream/chat-live/limits with only the changed field", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, threshold_per_second: 3 });
      })
    );
    const { result } = renderHook(() => useStreamLimitsMutation(), { wrapper: createWrapper() });
    result.current.mutate({ threshold_per_second: 3 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedBody).toEqual({ threshold_per_second: 3 });
    expect(result.current.data?.threshold_per_second).toBe(3);
  });

  it("throws ValidationError on 422 invalid_filter_policy", async () => {
    server.use(streamLimitsValidationHandler());
    const { result } = renderHook(() => useStreamLimitsMutation(), { wrapper: createWrapper() });
    result.current.mutate({ filter_policy: "bogus" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ValidationError);
  });
});
