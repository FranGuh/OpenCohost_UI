import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useVisionPhaseStore } from "../store/visionStore.js";
import { VISION_QUERY_KEY, useVisionLooking } from "./vision.js";

describe("useVisionLooking", () => {
  it("follows status.looking in the cache and never fetches", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useVisionLooking(), { wrapper });
    expect(result.current).toBe(false);
    act(() => {
      queryClient.setQueryData(VISION_QUERY_KEY, { enabled: true, status: { looking: true } });
    });
    await waitFor(() => expect(result.current).toBe(true));
    act(() => {
      queryClient.setQueryData(VISION_QUERY_KEY, { enabled: true, status: { looking: false } });
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("stays true through the describing phase even if a status poll reports looking=false", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    queryClient.setQueryData(VISION_QUERY_KEY, { enabled: true, status: { looking: false } });
    const { result } = renderHook(() => useVisionLooking(), { wrapper });
    expect(result.current).toBe(false);
    act(() => useVisionPhaseStore.getState().setPhase("describing"));
    await waitFor(() => expect(result.current).toBe(true));
    act(() => useVisionPhaseStore.getState().setPhase("done"));
    await waitFor(() => expect(result.current).toBe(false));
  });
});
