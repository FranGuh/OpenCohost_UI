import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  defaultMemoriaNotice,
  defaultMemoriaRows,
  defaultMemoriaStats,
  memoriaDeleteNotFoundHandler,
  memoriaDeleteUnavailableHandler,
  memoriaFlagsNotFoundHandler,
  memoriaFlagsUnavailableHandler,
  memoriaFlagsValidationHandler,
  memoriaNoticeGetErrorHandler,
  memoriaRowNotFoundHandler,
  memoriaRowUnavailableHandler,
  memoriaUpdateNotFoundHandler,
  memoriaUpdateUnavailableHandler,
  memoriaUpdateValidationHandler
} from "../test/handlers.js";
import { ApiError, NotFoundError, ValidationError } from "./client.js";
import {
  getMemoriaNotice,
  getMemoriaRow,
  postMemoriaCapture,
  postMemoriaDelete,
  postMemoriaFlags,
  postMemoriaNotice,
  postMemoriaUpdate,
  useMemoriaCaptureMutation,
  useMemoriaDeleteMutation,
  useMemoriaFlagsMutation,
  useMemoriaNoticeMutation,
  useMemoriaNoticeQuery,
  useMemoriaPurgeMutation,
  useMemoriaRowQuery,
  useMemoriaStatsQuery,
  useMemoriaUpdateMutation
} from "./memoria.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Same as createWrapper, but also hands back the QueryClient instance so a
 * test can spy on invalidateQueries (mirrors profiles.test.ts). */
function createWrapperWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe("useMemoriaStatsQuery", () => {
  it("parses counts-only fields from GET /api/memoria/stats", async () => {
    const { result } = renderHook(() => useMemoriaStatsQuery("profile-id-default"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultMemoriaStats));
  });

  it("passes profile_id to the request so counts are per-profile", async () => {
    let capturedUrl: string | null = null;
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/stats`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(defaultMemoriaStats);
      })
    );
    const { result } = renderHook(() => useMemoriaStatsQuery("profile-id-akira"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultMemoriaStats));
    expect(capturedUrl).toContain("profile_id=profile-id-akira");
  });

  it("omits profile_id when the active profile is null (global counts)", async () => {
    let capturedUrl: string | null = null;
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/stats`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(defaultMemoriaStats);
      })
    );
    const { result } = renderHook(() => useMemoriaStatsQuery(""), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultMemoriaStats));
    expect(capturedUrl).not.toContain("profile_id");
  });

  it("surfaces an error state honestly when the request fails", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/stats`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    const { result } = renderHook(() => useMemoriaStatsQuery("profile-id-default"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("postMemoriaFlags", () => {
  it("posts profile_id/id/flags and resolves ok:true", async () => {
    const result = await postMemoriaFlags({ profile_id: "default", id: "mem_a", pinned: true });
    expect(result).toEqual({ ok: true });
  });

  it("throws ValidationError on 422 (no flags provided)", async () => {
    server.use(memoriaFlagsValidationHandler());
    await expect(postMemoriaFlags({ profile_id: "default", id: "mem_a" })).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError on 404 (memoria not found / wrong profile)", async () => {
    server.use(memoriaFlagsNotFoundHandler());
    await expect(postMemoriaFlags({ profile_id: "default", id: "does-not-exist", pinned: true })).rejects.toThrow(
      NotFoundError
    );
  });

  it("throws ApiError on 503 (memoria_unavailable / memoria_write_failed)", async () => {
    server.use(memoriaFlagsUnavailableHandler());
    await expect(postMemoriaFlags({ profile_id: "default", id: "mem_a", pinned: true })).rejects.toThrow(ApiError);
  });
});

describe("useMemoriaFlagsMutation", () => {
  it("invalidates the row list and the stats query on success", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMemoriaFlagsMutation("default"), { wrapper });
    result.current.mutate({ id: "mem_a", pinned: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-list", "default"] }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-stats", "default"] }));
  });
});

describe("useMemoriaPurgeMutation", () => {
  it("empties the list cache and invalidates the per-profile stats on success", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMemoriaPurgeMutation("default"), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["memoria-list", "default"])).toEqual({ items: [] });
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-stats", "default"] }));
  });
});

describe("postMemoriaDelete", () => {
  it("posts profile_id/id and resolves ok:true", async () => {
    const result = await postMemoriaDelete({ profile_id: "default", id: "mem_a" });
    expect(result).toEqual({ ok: true });
  });

  it("throws NotFoundError on 404 (memoria not found / wrong profile)", async () => {
    server.use(memoriaDeleteNotFoundHandler());
    await expect(postMemoriaDelete({ profile_id: "default", id: "does-not-exist" })).rejects.toThrow(NotFoundError);
  });

  it("throws ApiError on 503 (memoria_unavailable / memoria_write_failed)", async () => {
    server.use(memoriaDeleteUnavailableHandler());
    await expect(postMemoriaDelete({ profile_id: "default", id: "mem_a" })).rejects.toThrow(ApiError);
  });
});

describe("useMemoriaDeleteMutation", () => {
  it("invalidates the row list and the stats query on success", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMemoriaDeleteMutation("default"), { wrapper });
    result.current.mutate("mem_a");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ ok: true });
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-list", "default"] }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-stats", "default"] }));
  });
});

describe("postMemoriaUpdate", () => {
  it("posts profile_id/id/title/content and resolves ok:true", async () => {
    const result = await postMemoriaUpdate({
      profile_id: "default",
      id: "mem_a",
      title: "new title",
      content: "new content"
    });
    expect(result).toEqual({ ok: true });
  });

  it("throws ValidationError on 422 (empty or over-length title/content)", async () => {
    server.use(memoriaUpdateValidationHandler());
    await expect(
      postMemoriaUpdate({ profile_id: "default", id: "mem_a", title: "", content: "" })
    ).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError on 404 (memoria not found / wrong profile)", async () => {
    server.use(memoriaUpdateNotFoundHandler());
    await expect(
      postMemoriaUpdate({ profile_id: "default", id: "does-not-exist", title: "t", content: "c" })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ApiError on 503 (memoria_unavailable / memoria_write_failed)", async () => {
    server.use(memoriaUpdateUnavailableHandler());
    await expect(
      postMemoriaUpdate({ profile_id: "default", id: "mem_a", title: "t", content: "c" })
    ).rejects.toThrow(ApiError);
  });
});

describe("useMemoriaUpdateMutation", () => {
  it("resolves ok:true, never echoes title/content back, and invalidates only the row list (not stats)", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMemoriaUpdateMutation("default"), { wrapper });
    result.current.mutate({ id: "mem_a", title: "t", content: "c" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ ok: true });
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-list", "default"] }));
    expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-stats", "default"] }));
  });
});

describe("postMemoriaCapture", () => {
  it("posts paused:true and resolves ok:true", async () => {
    const result = await postMemoriaCapture({ paused: true });
    expect(result).toEqual({ ok: true });
  });
});

describe("useMemoriaCaptureMutation", () => {
  it("resolves ok:true for both pause (true) and resume (false)", async () => {
    const { result } = renderHook(() => useMemoriaCaptureMutation(), { wrapper: createWrapper() });
    result.current.mutate(false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ok: true });
  });
});

describe("getMemoriaRow", () => {
  it("resolves id/title/content/dates/flags for one row on demand", async () => {
    const result = await getMemoriaRow("mem_a", "default");
    expect(result).toEqual(defaultMemoriaRows.mem_a);
  });

  it("throws NotFoundError on 404 (memoria not found / wrong profile)", async () => {
    server.use(memoriaRowNotFoundHandler());
    await expect(getMemoriaRow("does-not-exist", "default")).rejects.toThrow(NotFoundError);
  });

  it("throws ApiError on 503 (memoria_unavailable)", async () => {
    server.use(memoriaRowUnavailableHandler());
    await expect(getMemoriaRow("mem_a", "default")).rejects.toThrow(ApiError);
  });
});

describe("useMemoriaRowQuery", () => {
  it("does NOT fetch on mount (lazy, click-to-load only) and resolves on manual refetch", async () => {
    const { result } = renderHook(() => useMemoriaRowQuery("default", "mem_a"), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();

    await result.current.refetch();
    await waitFor(() => expect(result.current.data).toEqual(defaultMemoriaRows.mem_a));
  });
});

describe("getMemoriaNotice", () => {
  it("parses dismissed from GET /api/memoria/notice", async () => {
    const result = await getMemoriaNotice();
    expect(result).toEqual(defaultMemoriaNotice);
  });

  it("throws ApiError when the request fails", async () => {
    server.use(memoriaNoticeGetErrorHandler());
    await expect(getMemoriaNotice()).rejects.toThrow(ApiError);
  });
});

describe("useMemoriaNoticeQuery", () => {
  it("hydrates from GET /api/memoria/notice", async () => {
    const { result } = renderHook(() => useMemoriaNoticeQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultMemoriaNotice));
  });
});

describe("postMemoriaNotice", () => {
  it("posts dismissed:true and the response reflects it", async () => {
    const result = await postMemoriaNotice({ dismissed: true });
    expect(result).toEqual({ dismissed: true });
  });
});

describe("useMemoriaNoticeMutation", () => {
  it("writes the returned dismissed state into the memoria-notice query cache", async () => {
    const { result } = renderHook(() => useMemoriaNoticeMutation(), { wrapper: createWrapper() });
    result.current.mutate({ dismissed: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ dismissed: true });
  });
});
