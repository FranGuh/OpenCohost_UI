import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultTtsConfig } from "../test/handlers.js";
import { useTtsConfigQuery } from "./tts.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useTtsConfigQuery", () => {
  it("parses piper_voice/local_only/speed/engine/heavy_available from GET /api/tts/config", async () => {
    const { result } = renderHook(() => useTtsConfigQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultTtsConfig));
  });

  it("surfaces an error state honestly when the request fails", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    const { result } = renderHook(() => useTtsConfigQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
