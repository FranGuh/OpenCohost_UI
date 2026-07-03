import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultModels } from "../test/handlers.js";
import { useModelsQuery } from "./models.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useModelsQuery", () => {
  it("parses catalog/discovered/current_model/tiers/active_tier from GET /api/models", async () => {
    const { result } = renderHook(() => useModelsQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultModels));
  });

  it("surfaces an error state honestly when the request fails", async () => {
    server.use(http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    const { result } = renderHook(() => useModelsQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
