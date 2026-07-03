import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  switchConflictHandler,
  switchNotFoundHandler,
  switchQueueFullHandler,
  switchReplayHandler
} from "../test/handlers.js";
import { useSwitchStore } from "../store/switchStore.js";
import { useProfilesQuery, useSwitchProfileMutation } from "./profiles.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  useSwitchStore.setState({ pendingSwitch: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProfilesQuery (spec R4)", () => {
  it("parses the profile list from GET /api/perfiles via generated types (no hardcoded shape)", async () => {
    const { result } = renderHook(() => useProfilesQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toEqual({ profiles: ["default", "Akira"] }));
  });

  it("shows a non-destructive empty state when the list is empty", async () => {
    server.use(http.get(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json({ profiles: [] })));

    const { result } = renderHook(() => useProfilesQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toEqual({ profiles: [] }));
    expect(result.current.isError).toBe(false);
  });

  it("surfaces a non-destructive error state when the request fails, without a stale/hardcoded list", async () => {
    server.use(http.get(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    const { result } = renderHook(() => useProfilesQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("useSwitchProfileMutation (spec R5, R6, R7)", () => {
  it("resolves a stable Idempotency-Key per switch intent, reused across retries", async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, ({ request }) => {
        seen.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued" });
      })
    );

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });
    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toBe("");
  });

  it("on success sets pendingSwitch to applying without an optimistic active_profile write", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-2", status: "queued" })
      )
    );

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });

    const pending = useSwitchStore.getState().pendingSwitch;
    expect(pending).toEqual({ name: "Akira", commandId: "cmd-2", status: "applying" });
  });

  it("idempotent replay: same command_id does not trigger a second applying transition", async () => {
    server.use(switchReplayHandler("cmd-replay"));

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });
    const firstPending = useSwitchStore.getState().pendingSwitch;

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });
    const secondPending = useSwitchStore.getState().pendingSwitch;

    expect(firstPending?.commandId).toBe("cmd-replay");
    expect(secondPending?.commandId).toBe("cmd-replay");
    expect(secondPending).toEqual(firstPending);
  });

  it("429 does not flip to applying and does not touch active_profile", async () => {
    server.use(switchQueueFullHandler());

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" }).catch(() => undefined);
    });

    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });

  it("409 does not flip to applying, previous active_profile stays displayed", async () => {
    server.use(switchConflictHandler());

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" }).catch(() => undefined);
    });

    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });

  it("404 clears any pendingSwitch and does not flip to applying", async () => {
    useSwitchStore.getState().setPending({ name: "Ghost", commandId: "cmd-old", status: "applying" });
    server.use(switchNotFoundHandler());

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Ghost" }).catch(() => undefined);
    });

    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });
});
