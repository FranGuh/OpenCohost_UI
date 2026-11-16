import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, makeDownloadJob } from "../test/handlers.js";
import {
  ModelDownloadApiError,
  downloadsNeedPolling,
  formatBytes,
  formatEta,
  formatSpeed,
  getHfQuants,
  normalizeHfRepo,
  postModelDownloadAction,
  startModelDownload,
  useModelDownloadsQuery
} from "./modelDownloads.js";

describe("normalizeHfRepo (client-side owner/repo extraction)", () => {
  it("accepts a bare owner/repo", () => {
    expect(normalizeHfRepo("bartowski/SmolLM2-135M-Instruct-GGUF")).toEqual({
      owner: "bartowski",
      repo: "SmolLM2-135M-Instruct-GGUF"
    });
  });

  it("accepts hf.co/owner/repo, dropping a trailing :quant", () => {
    expect(normalizeHfRepo("hf.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF:Q4_K_M")).toEqual({
      owner: "ISTA-DASLab",
      repo: "Qwen3.8-27B-GSQ-RCO-GGUF"
    });
  });

  it("accepts a full https://huggingface.co URL with extra path segments and whitespace", () => {
    expect(normalizeHfRepo("  https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/tree/main  ")).toEqual({
      owner: "bartowski",
      repo: "Llama-3.2-3B-Instruct-GGUF"
    });
    expect(normalizeHfRepo("huggingface.co/owner/repo?x=1")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("rejects input without an owner/repo pair or with illegal characters", () => {
    expect(normalizeHfRepo("")).toBeNull();
    expect(normalizeHfRepo("just-a-name")).toBeNull();
    expect(normalizeHfRepo("https://example.com/owner/repo")).toBeNull();
    expect(normalizeHfRepo("owner/re po")).toBeNull();
  });
});

describe("human formatting", () => {
  it("formats bytes as MB below 1 GiB and GB above", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(398 * 1024 * 1024)).toBe("398.0 MB");
    expect(formatBytes(2.5 * 1024 ** 3)).toBe("2.50 GB");
    expect(formatBytes(null)).toBe("—");
  });

  it("formats speed as MB/s", () => {
    expect(formatSpeed(2.5 * 1024 * 1024)).toBe("2.5 MB/s");
    expect(formatSpeed(null)).toBe("—");
  });

  it("formats ETA in seconds, minutes and hours", () => {
    expect(formatEta(42)).toBe("42s");
    expect(formatEta(185)).toBe("3m 05s");
    expect(formatEta(3720)).toBe("1h 02m");
    expect(formatEta(null)).toBe("—");
  });
});

describe("downloadsNeedPolling", () => {
  it("is true only while some job is queued, downloading or retrying", () => {
    expect(downloadsNeedPolling(undefined)).toBe(false);
    expect(downloadsNeedPolling({ jobs: [], active_job_id: null, max_retries: 3 })).toBe(false);
    for (const state of ["queued", "downloading", "retrying"] as const) {
      expect(downloadsNeedPolling({ jobs: [makeDownloadJob({ state })], active_job_id: "j1", max_retries: 3 })).toBe(true);
    }
    for (const state of ["paused", "completed", "failed", "cancelled"] as const) {
      expect(downloadsNeedPolling({ jobs: [makeDownloadJob({ state })], active_job_id: null, max_retries: 3 })).toBe(false);
    }
  });
});

describe("startModelDownload error mapping", () => {
  it("returns the 202 job", async () => {
    const job = await startModelDownload("qwen3:1.7b");
    expect(job.tag).toBe("qwen3:1.7b");
    expect(job.state).toBe("queued");
  });

  it("maps 409 download_active to a typed error carrying active_job_id", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads`, () =>
        HttpResponse.json({ detail: "download_active", active_job_id: "job-busy" }, { status: 409 })
      )
    );
    const error = await startModelDownload("qwen3:1.7b").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelDownloadApiError);
    expect((error as ModelDownloadApiError).status).toBe(409);
    expect((error as ModelDownloadApiError).detail).toBe("download_active");
    expect((error as ModelDownloadApiError).activeJobId).toBe("job-busy");
  });

  it("maps 503 ollama_unreachable and 422 invalid_tag details", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads`, () =>
        HttpResponse.json({ detail: "ollama_unreachable" }, { status: 503 })
      )
    );
    await expect(startModelDownload("qwen3:1.7b")).rejects.toMatchObject({ detail: "ollama_unreachable", status: 503 });
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads`, () => HttpResponse.json({ detail: "invalid_tag" }, { status: 422 }))
    );
    await expect(startModelDownload("bad tag")).rejects.toMatchObject({ detail: "invalid_tag", status: 422 });
  });
});

describe("postModelDownloadAction", () => {
  it("posts to /{id}/{action} and returns the job", async () => {
    let seen = "";
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads/:id/:action`, ({ params }) => {
        seen = `${String(params.id)}/${String(params.action)}`;
        return HttpResponse.json(makeDownloadJob({ id: String(params.id), state: "paused" }));
      })
    );
    const job = await postModelDownloadAction("job-1", "pause");
    expect(seen).toBe("job-1/pause");
    expect(job.state).toBe("paused");
  });

  it("maps 409 invalid_transition", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads/:id/:action`, () =>
        HttpResponse.json({ detail: "invalid_transition" }, { status: 409 })
      )
    );
    await expect(postModelDownloadAction("job-1", "resume")).rejects.toMatchObject({ detail: "invalid_transition" });
  });
});

describe("getHfQuants", () => {
  it("requests the encoded owner/repo path and returns quants", async () => {
    const result = await getHfQuants({ owner: "bartowski", repo: "SmolLM2-135M-Instruct-GGUF" });
    expect(result.quants.length).toBeGreaterThan(0);
    expect(result.quants[0].tag).toMatch(/^hf\.co\/bartowski\/SmolLM2-135M-Instruct-GGUF:/);
  });

  it.each([
    [404, "hf_repo_not_found"],
    [502, "hf_unavailable"],
    [422, "invalid_hf_repo"]
  ])("maps %s to detail %s", async (status, detail) => {
    server.use(
      http.get(`${API_BASE_URL}/api/models/hf/:owner/:repo/quants`, () => HttpResponse.json({ detail }, { status }))
    );
    await expect(getHfQuants({ owner: "o", repo: "r" })).rejects.toMatchObject({ detail, status });
  });
});

describe("useModelDownloadsQuery polls only while a job is active", () => {
  function createWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls every ~1s while downloading and stops once the job completes", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/models/downloads`, () => {
        calls += 1;
        const state = calls < 3 ? "downloading" : "completed";
        return HttpResponse.json({
          jobs: [makeDownloadJob({ state, percent: state === "completed" ? 100 : 40 })],
          active_job_id: state === "completed" ? null : "job-1",
          max_retries: 3
        });
      })
    );

    renderHook(() => useModelDownloadsQuery(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(calls).toBe(2);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(calls).toBe(3); // this response is "completed"

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(calls).toBe(3);
  });

  it("does not poll when no job is active", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/models/downloads`, () => {
        calls += 1;
        return HttpResponse.json({ jobs: [makeDownloadJob({ state: "paused" })], active_job_id: null, max_retries: 3 });
      })
    );
    renderHook(() => useModelDownloadsQuery(), { wrapper: createWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(calls).toBe(1);
  });
});
