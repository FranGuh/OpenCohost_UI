import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL, makeDownloadJob } from "../../test/handlers.js";
import type { ModelDownloadJob } from "../../api/modelDownloads.js";
import type { VisionBenchmark, VisionModelsResponse, VisionResponse } from "../../api/vision.js";
import { VisionModelPicker } from "./VisionModelPicker.js";
import { isVisionDownloadJob } from "./visionCatalog.js";

const DATA: VisionResponse = {
  enabled: false,
  look_on_ptt: false,
  capture_delay_s: 1,
  rule_gate_enabled: false,
  model: "qwen3-vl:4b-instruct",
  port: 11435,
  describe_timeout_s: 8,
  status: { daemon_state: "stopped", model_installed: true, capture_available: true, armed: false, looking: false }
};

const MODELS: VisionModelsResponse = {
  current: "qwen3-vl:4b-instruct",
  installed: [
    { tag: "qwen3-vl:4b-instruct", vision: true, size_bytes: 3_000_000_000 },
    { tag: "custom-eyes:3b", vision: true, size_bytes: 2_000_000_000 },
    { tag: "mystery:7b", vision: null, size_bytes: null },
    { tag: "llama3:8b", vision: false, size_bytes: 4_000_000_000 }
  ],
  suggested: [
    { tag: "qwen3-vl:2b-instruct", display: "Qwen3-VL 2B Instruct", size_gb: 1.9, desc: "Light, for gaming. Describes in English." }
  ],
  ollama_reachable: true
};

const job = (tag: string, overrides: Partial<ModelDownloadJob> = {}) =>
  makeDownloadJob({ id: `job-${tag}`, tag, state: "paused", ...overrides });

describe("isVisionDownloadJob", () => {
  it("keeps catalog, installed-vision and vision-like tags", () => {
    expect(isVisionDownloadJob(job("qwen3-vl:2b-instruct"), MODELS)).toBe(true);
    expect(isVisionDownloadJob(job("qwen3-vl:2b-instruct:latest"), MODELS)).toBe(true);
    expect(isVisionDownloadJob(job("custom-eyes:3b"), MODELS)).toBe(true);
    const benchmarks = { "gemma4:e4b": {} as VisionBenchmark };
    expect(isVisionDownloadJob(job("gemma4:e4b"), { ...MODELS, benchmarks })).toBe(true);
    expect(isVisionDownloadJob(job("hf.co/unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M"), MODELS)).toBe(true);
    expect(isVisionDownloadJob(job("llama3.2-vision:11b"), MODELS)).toBe(true);
    expect(isVisionDownloadJob(job("llava:7b"), undefined)).toBe(true);
  });

  it("drops chat models, unverified installs and installs reported as non-vision", () => {
    expect(isVisionDownloadJob(job("hf.co/someone/Qwen3.8-9B-Distill-GGUF:Q4_K_M"), MODELS)).toBe(false);
    expect(isVisionDownloadJob(job("llama3:8b"), MODELS)).toBe(false);
    expect(isVisionDownloadJob(job("mystery:7b"), MODELS)).toBe(false);
    expect(isVisionDownloadJob(job("qwen3:1.7b"), undefined)).toBe(false);
    // An explicit non-vision verdict beats a vision-looking name.
    const installed = [{ tag: "fake-vl:1b", vision: false, size_bytes: null }];
    expect(isVisionDownloadJob(job("fake-vl:1b"), { ...MODELS, installed })).toBe(false);
  });
});

function renderPicker() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(VisionModelPicker, { data: DATA, onSelect: () => undefined })
    )
  );
}

function serve(jobs: ModelDownloadJob[]) {
  server.use(
    http.get(`${API_BASE_URL}/api/vision/models`, () => HttpResponse.json(MODELS)),
    http.get(`${API_BASE_URL}/api/models/downloads`, () => HttpResponse.json({ jobs, active_job_id: null, max_retries: 3 }))
  );
}

describe("VisionModelPicker", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("shows only vision download jobs, never a chat-model pull", async () => {
    serve([
      job("hf.co/someone/Qwen3.8-9B-Distill-GGUF:Q4_K_M", { state: "completed", installed: true }),
      job("qwen3-vl:2b-instruct", { state: "failed" })
    ]);
    renderPicker();
    expect((await screen.findAllByText("qwen3-vl:2b-instruct")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Qwen3\.8-9B-Distill/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use this model/ })).not.toBeInTheDocument();
  });

  it("renders the suggested desc localized by tag", async () => {
    serve([]);
    renderPicker();
    expect(
      await screen.findByText("Light, for gaming. Described in English when measured, before the Spanish prompt.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Light, for gaming. Describes in English.")).not.toBeInTheDocument();
  });
});
