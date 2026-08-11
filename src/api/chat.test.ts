import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  chatTurnConflictHandler,
  chatTurnNetworkErrorHandler,
  chatTurnQueueFullHandler,
  chatTurnValidationHandler,
  defaultLastReply,
  lastReplyHandler
} from "../test/handlers.js";
import { useLastReply, useSendChatTurn } from "./chat.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useSendChatTurn", () => {
  it("sends the text with a rotating Idempotency-Key, rotating only after a successful accept", async () => {
    const headersSeen: string[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
        headersSeen.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 });
      })
    );

    const { result } = renderHook(() => useSendChatTurn(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("hola");
    });
    await act(async () => {
      await result.current.send("de nuevo");
    });

    expect(headersSeen).toHaveLength(2);
    expect(headersSeen[0]).not.toBe(headersSeen[1]);
    expect(result.current.pending).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  // The composer-lockout bug: dispatch.py rejects a reused key carrying a
  // DIFFERENT payload with a 409 that sticks for the full 600s TTL, so one
  // failure followed by "let me reword that" bricked the composer for ten
  // minutes. These two tests pin BOTH halves — the retry must still dedupe.
  it("keeps the SAME key when the operator retries the identical text after a failure", async () => {
    const headersSeen: string[] = [];
    let fail = true;
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
        headersSeen.push(request.headers.get("Idempotency-Key") ?? "");
        if (fail) return new HttpResponse(null, { status: 500 });
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 });
      })
    );

    const { result } = renderHook(() => useSendChatTurn(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("hola").catch(() => undefined);
    });
    fail = false;
    await act(async () => {
      await result.current.send("hola");
    });

    expect(headersSeen).toHaveLength(2);
    expect(headersSeen[0]).toBe(headersSeen[1]);
  });

  it("rotates the key when the operator EDITS the text after a failure", async () => {
    const headersSeen: string[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
        headersSeen.push(request.headers.get("Idempotency-Key") ?? "");
        return new HttpResponse(null, { status: 500 });
      })
    );

    const { result } = renderHook(() => useSendChatTurn(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("hola").catch(() => undefined);
    });
    await act(async () => {
      await result.current.send("hola, ¿me escuchás?").catch(() => undefined);
    });

    expect(headersSeen).toHaveLength(2);
    expect(headersSeen[0]).not.toBe(headersSeen[1]);
  });

  it("is pending while the request is in flight", async () => {
    let resolveRequest!: () => void;
    server.use(
      http.post(
        `${API_BASE_URL}/api/chat/turn`,
        () =>
          new Promise((resolve) => {
            resolveRequest = () =>
              resolve(
                HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 })
              );
          })
      )
    );

    const { result } = renderHook(() => useSendChatTurn(), { wrapper: createWrapper() });

    let sendPromise!: Promise<unknown>;
    act(() => {
      sendPromise = result.current.send("hola");
    });

    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      resolveRequest();
      await sendPromise;
    });

    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it("surfaces a 409 conflict honestly via isError/error", async () => {
    server.use(chatTurnConflictHandler());
    const { result } = renderHook(() => useSendChatTurn(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("hola").catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/conflict/);
  });

  it("surfaces a 429 queue-full error honestly", async () => {
    server.use(chatTurnQueueFullHandler());
    const { result } = renderHook(() => useSendChatTurn(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("hola").catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("surfaces a 422 validation error with the backend detail", async () => {
    server.use(chatTurnValidationHandler("text must be non-empty"));
    const { result } = renderHook(() => useSendChatTurn(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("").catch(() => undefined);
    });

    await waitFor(() => expect(result.current.error?.message).toBe("text must be non-empty"));
  });

  it("surfaces a network error honestly", async () => {
    server.use(chatTurnNetworkErrorHandler());
    const { result } = renderHook(() => useSendChatTurn(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.send("hola").catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useLastReply", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetches the shape returned by GET /api/chat/last-reply", async () => {
    server.use(lastReplyHandler({ text: "todo bien por acá", source: "llm", turn_id: 3, ts: 1000 }));
    const { result } = renderHook(() => useLastReply(), { wrapper: createWrapper() });

    await act(() => vi.advanceTimersByTimeAsync(0));
    // Unit 4.2 (runtime_findings_batch_20260731, D3b/F12): the response grew
    // queue_wait_ms and four provider-disclosure fields — all null here since
    // this fixture never tags them (mirrors defaultLastReply's shape below).
    expect(result.current.data).toEqual({
      text: "todo bien por acá",
      source: "llm",
      turn_id: 3,
      ts: 1000,
      queue_wait_ms: null,
      answered_by_provider: null,
      answered_by_transport: null,
      submitted_under_provider: null,
      provider_changed_while_queued: null
    });
  });

  it("treats text: null as no reply yet, matching the default handler", async () => {
    const { result } = renderHook(() => useLastReply(), { wrapper: createWrapper() });

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.data).toEqual(defaultLastReply);
  });

  it("polls approximately every 1.5s", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/chat/last-reply`, () => {
        calls += 1;
        return HttpResponse.json(defaultLastReply);
      })
    );
    renderHook(() => useLastReply(), { wrapper: createWrapper() });

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(calls).toBe(2);
  });
});
