import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  defaultStreamChatLive,
  streamChatLiveUnavailableHandler,
  streamConnectBusyHandler,
  streamConnectInvalidUrlHandler,
  streamLimitsValidationHandler
} from "../test/handlers.js";
import {
  StreamConnectTimeoutError,
  connectStreamAndAwait,
  useStreamChatLiveQuery,
  useStreamConnectMutation,
  useStreamDisconnectMutation,
  useStreamLimitsMutation
} from "./stream.js";
import { ApiError, ConflictError, ValidationError } from "./client.js";

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
      "filter_policy"
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
