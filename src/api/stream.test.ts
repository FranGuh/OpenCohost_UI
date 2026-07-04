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
  useStreamChatLiveQuery,
  useStreamConnectMutation,
  useStreamDisconnectMutation,
  useStreamLimitsMutation
} from "./stream.js";
import { ConflictError, ValidationError } from "./client.js";

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
