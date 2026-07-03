import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultMemoriaStats } from "../test/handlers.js";
import { useMemoriaStatsQuery } from "./memoria.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useMemoriaStatsQuery", () => {
  it("parses counts-only fields from GET /api/memoria/stats", async () => {
    const { result } = renderHook(() => useMemoriaStatsQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultMemoriaStats));
  });

  it("surfaces an error state honestly when the request fails", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/stats`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    const { result } = renderHook(() => useMemoriaStatsQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
