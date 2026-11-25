import { delay, http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultLlmProvider, defaultStatus, llmProviderGetErrorHandler, llmProviderGetHandler } from "../../test/handlers.js";
import type { VisionModelsResponse, VisionResponse } from "../../api/vision.js";
import { VisionCard } from "./VisionCard.js";

const BASE: VisionResponse = {
  enabled: true,
  look_on_ptt: false,
  capture_delay_s: 1,
  rule_gate_enabled: false,
  model: "qwen3-vl:4b-instruct",
  port: 11435,
  describe_timeout_s: 8,
  status: { daemon_state: "stopped", model_installed: true, capture_available: true, armed: false, looking: false }
};

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(VisionCard)));
}

function serve(initial: Partial<VisionResponse> = {}, opts: { putStatus?: number } = {}) {
  const state = { current: { ...BASE, ...initial } as VisionResponse, puts: [] as unknown[] };
  server.use(
    http.get(`${API_BASE_URL}/api/vision`, () => HttpResponse.json(state.current)),
    http.put(`${API_BASE_URL}/api/vision`, async ({ request }) => {
      const body = (await request.json()) as Partial<VisionResponse>;
      state.puts.push(body);
      if (opts.putStatus) return HttpResponse.json({ detail: "vision_write_failed" }, { status: opts.putStatus });
      state.current = { ...state.current, ...body };
      return HttpResponse.json(state.current);
    })
  );
  return state;
}

const MODELS: VisionModelsResponse = {
  current: "qwen3-vl:4b-instruct",
  installed: [
    { tag: "qwen3-vl:4b-instruct", vision: true, size_bytes: 3_000_000_000 },
    { tag: "mystery:7b", vision: null, size_bytes: null },
    { tag: "llama3:8b", vision: false, size_bytes: 4_000_000_000 }
  ],
  suggested: [{ tag: "gemma3:4b", display: "Gemma 3 4B", size_gb: 3.3, desc: "Small and quick" }],
  ollama_reachable: true
};

async function openAdvanced() {
  await userEvent.click(await screen.findByRole("button", { name: "Advanced" }));
}

function serveModels(models: Partial<VisionModelsResponse> = {}) {
  server.use(http.get(`${API_BASE_URL}/api/vision/models`, () => HttpResponse.json({ ...MODELS, ...models })));
}

describe("VisionCard model picker", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("lists installed vision-capable models, marks unverified, hides non-vision", async () => {
    serve();
    serveModels();
    renderCard();
    await userEvent.click(await screen.findByRole("combobox", { name: "Vision model" }));
    expect(await screen.findByRole("option", { name: /mystery:7b.*unverified/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /llama3:8b/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /gemma3:4b|Gemma 3 4B/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("choosing an installed model sends a partial PUT {model}", async () => {
    const state = serve();
    serveModels();
    renderCard();
    await userEvent.click(await screen.findByRole("combobox", { name: "Vision model" }));
    await userEvent.click(await screen.findByRole("option", { name: /mystery:7b/ }));
    await waitFor(() => expect(state.puts).toEqual([{ model: "mystery:7b" }]));
  });

  it("shows suggested desc and size with a Download action that starts the pull", async () => {
    serve();
    serveModels();
    let started: unknown = null;
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
        started = await request.json();
        return HttpResponse.json(
          { id: "j", tag: "gemma3:4b", state: "queued", phase: null, total_bytes: null, completed_bytes: null, percent: null, speed_bps: null, eta_seconds: null, attempt: 1, retries_used: 0, error_category: null, error_type: null, interrupted: false, installed: null, created_at: 1, updated_at: 1 },
          { status: 202 }
        );
      })
    );
    renderCard();
    await openAdvanced();
    expect(await screen.findByText(/Small and quick/)).toBeInTheDocument();
    expect(screen.getByText(/3\.3 GB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download Gemma 3 4B" }));
    await waitFor(() => expect(started).toEqual({ tag: "gemma3:4b" }));
  });

  it("shows a hint and keeps the current model when Ollama is unreachable", async () => {
    serve();
    serveModels({ installed: [], suggested: [], ollama_reachable: false });
    renderCard();
    expect(await screen.findByText("Ollama is not reachable, so the model list is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Vision model" })).toHaveTextContent("qwen3-vl:4b-instruct");
  });

  it("shows the model status line, with the missing-model copy on failure", async () => {
    serve({ enabled: true, model: "gemma3:4b", status: { ...BASE.status, state: "failed", last_error: "model_missing", model_installed: false } });
    serveModels({ current: "gemma3:4b" });
    renderCard();
    expect(await screen.findByText(/Model status: failed/)).toBeInTheDocument();
    expect(screen.getByText(/Model not installed: run `ollama pull gemma3:4b`/)).toBeInTheDocument();
  });
});

const BENCH = {
  "qwen3-vl:4b-instruct": {
    verdict: "recommended",
    vram_gib: 3.2,
    describe_s: 4.1,
    spanish: true,
    note: "Solid captions",
    measured_on: "2026-09-30"
  },
  "mystery:7b": {
    verdict: "broken",
    vram_gib: null,
    describe_s: null,
    spanish: null,
    note: "Invents objects",
    measured_on: "2026-09-29"
  },
  "gemma3:4b": {
    verdict: "light",
    vram_gib: 2.5,
    describe_s: 2,
    spanish: false,
    note: "Fast but terse",
    measured_on: "2026-09-28"
  }
};

describe("VisionCard model benchmarks", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("shows the verdict badge and detail line for the current model", async () => {
    serve();
    serveModels({ benchmarks: BENCH } as Partial<VisionModelsResponse>);
    renderCard();
    const detail = await screen.findByTestId("vision-bench-current");
    expect(detail).toHaveTextContent("Recommended");
    expect(detail).toHaveTextContent("3.2 GiB");
    expect(detail).toHaveTextContent("4.1 s");
    expect(detail).toHaveTextContent("Spanish: yes");
    // A catalog tag renders the UI-localized note, not the backend text.
    expect(detail).toHaveTextContent("Colors 12/12, HUD and text probes perfect; Spanish 8/10.");
    expect(detail).not.toHaveTextContent("Solid captions");
    expect(detail).toHaveTextContent("measured on 2026-09-30");
  });

  it("marks options with a verdict glyph", async () => {
    serve();
    serveModels({ benchmarks: BENCH } as Partial<VisionModelsResponse>);
    renderCard();
    await userEvent.click(await screen.findByRole("combobox", { name: "Vision model" }));
    expect(await screen.findByRole("option", { name: /qwen3-vl:4b-instruct.*✓/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /mystery:7b.*⚠/ })).toBeInTheDocument();
  });

  it("shows badge and details on suggested rows", async () => {
    serve();
    serveModels({ benchmarks: BENCH } as Partial<VisionModelsResponse>);
    renderCard();
    await openAdvanced();
    const row = await screen.findByTestId("vision-bench-gemma3:4b");
    expect(row).toHaveTextContent("Light");
    expect(row).toHaveTextContent("Spanish: no");
    expect(row).toHaveTextContent("Fast but terse");
  });

  it("warns inline when the current model is broken, and it stays selectable", async () => {
    const state = serve({ model: "mystery:7b" });
    serveModels({ current: "mystery:7b", benchmarks: BENCH } as Partial<VisionModelsResponse>);
    renderCard();
    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent(
      "This model failed our vision tests; Kira may describe things that are not there."
    );
    expect(screen.getByTestId("vision-bench-current")).toHaveTextContent("Broken vision");
    expect(screen.getByTestId("vision-bench-current")).toHaveTextContent("Spanish: unknown");
    await userEvent.click(screen.getByRole("combobox", { name: "Vision model" }));
    await userEvent.click(await screen.findByRole("option", { name: /qwen3-vl:4b-instruct/ }));
    await waitFor(() => expect(state.puts).toEqual([{ model: "qwen3-vl:4b-instruct" }]));
  });

  it("renders nothing extra without benchmarks (older backend) and no warning", async () => {
    serve();
    serveModels();
    renderCard();
    await screen.findByRole("combobox", { name: "Vision model" });
    expect(screen.queryByTestId("vision-bench-current")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("formats numbers with the UI locale", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve();
    serveModels({ benchmarks: BENCH } as Partial<VisionModelsResponse>);
    renderCard();
    const detail = await screen.findByTestId("vision-bench-current");
    expect(detail).toHaveTextContent("3,2 GiB");
    expect(detail).toHaveTextContent("Recomendado");
    expect(detail).toHaveTextContent("medido el 2026-09-30");
  });
});

describe("VisionCard", () => {
  // Test default locale is es; assert on the en copy.
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("reflects server state and shows the privacy note", async () => {
    serve({ enabled: true, look_on_ptt: true });
    renderCard();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable vision" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: "Look on push-to-talk" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Detect look phrases automatically" })).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Screenshots stay in memory, are never saved, and are only taken when you trigger a look.")
    ).toBeInTheDocument();
  });

  it("enabling vision sends a partial PUT", async () => {
    const state = serve({ enabled: false });
    renderCard();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable vision" })).toBeEnabled());
    await userEvent.click(screen.getByRole("switch", { name: "Enable vision" }));
    await waitFor(() => expect(state.puts).toEqual([{ enabled: true }]));
    expect(screen.getByRole("switch", { name: "Enable vision" })).toHaveAttribute("aria-checked", "true");
  });

  it("look-on-PTT and rule-gate switches each send their own key", async () => {
    const state = serve();
    renderCard();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Look on push-to-talk" })).toBeEnabled());
    await userEvent.click(screen.getByRole("switch", { name: "Look on push-to-talk" }));
    await waitFor(() => expect(state.puts).toContainEqual({ look_on_ptt: true }));
    await userEvent.click(screen.getByRole("switch", { name: "Detect look phrases automatically" }));
    await waitFor(() => expect(state.puts).toContainEqual({ rule_gate_enabled: true }));
  });

  it("rolls back and shows an inline error when the save fails", async () => {
    serve({ enabled: false }, { putStatus: 503 });
    renderCard();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable vision" })).toBeEnabled());
    await userEvent.click(screen.getByRole("switch", { name: "Enable vision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the vision settings. Try again.");
    expect(screen.getByRole("switch", { name: "Enable vision" })).toHaveAttribute("aria-checked", "false");
  });

  it("commits the capture delay on blur, clamped to 0-10 seconds", async () => {
    const state = serve();
    renderCard();
    const input = await screen.findByLabelText("Capture delay (seconds)");
    await waitFor(() => expect(input).toHaveValue(1));
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.puts).toEqual([{ capture_delay_s: 10 }]));
  });

  it("does not save the delay when it is unchanged or not a number", async () => {
    const state = serve();
    renderCard();
    const input = await screen.findByLabelText("Capture delay (seconds)");
    await waitFor(() => expect(input).toHaveValue(1));
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 50));
    expect(state.puts).toEqual([]);
    expect(input).toHaveValue(1);
  });

  it("shows burst defaults when the server omits them, with the thumbnails privacy hint", async () => {
    serve({ enabled: true });
    renderCard();
    const frames = await screen.findByLabelText("Frames per look");
    await waitFor(() => expect(frames).toHaveValue(3));
    expect(screen.getByLabelText("Frame interval (seconds)")).toHaveValue(1);
    expect(screen.getByRole("switch", { name: "Show thumbnails in chat" })).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("Thumbnails appear in this window; if you capture this window on stream, viewers can see them.")
    ).toBeInTheDocument();
  });

  it("commits frames as an integer clamped to 1-3", async () => {
    const state = serve({ frames: 3 });
    renderCard();
    const input = await screen.findByLabelText("Frames per look");
    await waitFor(() => expect(input).toHaveValue(3));
    fireEvent.change(input, { target: { value: "1.4" } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.puts).toEqual([{ frames: 1 }]));
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.puts).toEqual([{ frames: 1 }, { frames: 3 }]));
  });

  it("commits the frame interval clamped to 0.5-3 seconds", async () => {
    const state = serve({ frame_interval_s: 1 });
    renderCard();
    const input = await screen.findByLabelText("Frame interval (seconds)");
    await waitFor(() => expect(input).toHaveValue(1));
    fireEvent.change(input, { target: { value: "0.1" } });
    fireEvent.blur(input);
    await waitFor(() => expect(state.puts).toEqual([{ frame_interval_s: 0.5 }]));
  });

  it("the thumbnails switch sends show_thumbnails", async () => {
    const state = serve({ show_thumbnails: true });
    renderCard();
    const sw = await screen.findByRole("switch", { name: "Show thumbnails in chat" });
    await waitFor(() => expect(sw).toBeEnabled());
    await userEvent.click(sw);
    await waitFor(() => expect(state.puts).toEqual([{ show_thumbnails: false }]));
  });

  it("explains a missing model and a missing capture extra", async () => {
    serve({ status: { ...BASE.status, model_installed: false, capture_available: false } });
    renderCard();
    expect(await screen.findByText(/Model not installed: run/)).toHaveTextContent("ollama pull qwen3-vl:4b-instruct");
    expect(screen.getByText("Install the vision extra to enable screen capture.")).toBeInTheDocument();
  });

  it("shows the daemon state and model readiness when all is well", async () => {
    serve({ status: { ...BASE.status, daemon_state: "running" } });
    renderCard();
    expect(await screen.findByText("Vision engine: running")).toBeInTheDocument();
    expect(screen.getByText("Model installed")).toBeInTheDocument();
    expect(screen.queryByText("Screen capture available")).not.toBeInTheDocument();
  });

  it("shows a load error when the query fails", async () => {
    server.use(http.get(`${API_BASE_URL}/api/vision`, () => new HttpResponse(null, { status: 500 })));
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the vision settings.");
  });

  it("the frames hint scopes the limit to a normal look and points to clip mode", async () => {
    serve();
    renderCard();
    expect(
      await screen.findByText("1 to 3 captures in a normal look; near-identical ones are merged. For motion, use clip mode.")
    ).toBeInTheDocument();
  });

  it("explains how to ask for a normal, text and clip look, without any test button", async () => {
    serve();
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "How to ask for a look" }));
    const howTo = await screen.findByRole("region", { name: "How to ask for a look" });
    const items = within(howTo).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Normal");
    expect(items[0]).toHaveTextContent("look at this");
    expect(items[0]).toHaveTextContent("/mira");
    expect(items[1]).toHaveTextContent("Text");
    expect(items[1]).toHaveTextContent("read this");
    expect(items[1]).toHaveTextContent("/mira text");
    expect(items[2]).toHaveTextContent("Clip");
    expect(items[2]).toHaveTextContent("watch this");
    expect(items[2]).toHaveTextContent("/mira clip");
    expect(items[2]).toHaveTextContent("6 frames");
    expect(within(howTo).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /test|clip/i })).not.toBeInTheDocument();
  });

  it("shows the look guide in Spanish with the Spanish trigger phrases", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve();
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Cómo pedir una mirada" }));
    const howTo = await screen.findByRole("region", { name: "Cómo pedir una mirada" });
    expect(howTo).toHaveTextContent("mira esto");
    expect(howTo).toHaveTextContent("lee esto");
    expect(howTo).toHaveTextContent("/mira texto");
    expect(howTo).toHaveTextContent("mira este clip");
    expect(howTo).toHaveTextContent("/mira clip");
  });
});


describe("VisionCard vision source selector (cloud-providers-vision P3)", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  const LOCAL = /On this PC \(needs a GPU\)/;
  const CHAT = /Your model selected in the Models tab/;
  const CLOUD = /Another cloud model/;
  const cloud = (model: string, preset = "gemini", extra: Record<string, unknown> = {}) =>
    llmProviderGetHandler({
      ...defaultLlmProvider,
      active_provider: "gem",
      profiles: {
        gem: { base_url: "https://x/v1", model, preset, api_key_set: true, ...extra }
      }
    });

  it("shows the three sources with local selected by default", async () => {
    serve();
    renderCard();
    expect(await screen.findByRole("radio", { name: LOCAL })).toBeChecked();
    expect(screen.getByRole("radio", { name: CHAT })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: CLOUD })).not.toBeChecked();
  });

  it("choosing the chat model while the local provider is active shows the reason and saves nothing", async () => {
    const state = serve();
    renderCard();
    const radio = await screen.findByRole("radio", { name: CHAT });
    await waitFor(() => expect(radio).toBeEnabled());
    expect(screen.queryByText("Needs a cloud provider as the active provider.")).not.toBeInTheDocument();
    await userEvent.click(radio);
    expect(await screen.findByText("Needs a cloud provider as the active provider.")).toBeInTheDocument();
    expect(state.puts).toEqual([]);
  });

  it("choosing the chat model when the cloud model does not see images explains it and saves nothing", async () => {
    server.use(cloud("deepseek-v4-pro", "deepseek"));
    const state = serve();
    renderCard();
    const radio = await screen.findByRole("radio", { name: CHAT });
    await waitFor(() => expect(radio).toBeEnabled());
    await userEvent.click(radio);
    expect(await screen.findByText(/does not see images/)).toBeInTheDocument();
    expect(state.puts).toEqual([]);
  });

  it("enables the chat model for a vision model and saves vision_source", async () => {
    server.use(cloud("gemini-3.5-flash-lite"));
    const state = serve();
    renderCard();
    const radio = await screen.findByRole("radio", { name: CHAT });
    await waitFor(() => expect(radio).toBeEnabled());
    await userEvent.click(radio);
    await waitFor(() => expect(state.puts).toEqual([{ vision_source: "chat_model" }]));
  });

  it("honors the custom profile own sees-images flag", async () => {
    server.use(cloud("my-vl", "", { model_vision: true }));
    const state = serve();
    renderCard();
    const radio = await screen.findByRole("radio", { name: CHAT });
    await waitFor(() => expect(radio).toBeEnabled());
    await userEvent.click(radio);
    await waitFor(() => expect(state.puts).toEqual([{ vision_source: "chat_model" }]));
  });

  it("reads the P2 opt-in of an older backend as the chat model", async () => {
    server.use(cloud("gemini-3.5-flash-lite"));
    serve({ cloud_direct_allowed: true });
    renderCard();
    const radio = await screen.findByRole("radio", { name: CHAT });
    await waitFor(() => expect(radio).toBeChecked());
  });

  it("choosing local saves vision_source local", async () => {
    server.use(cloud("gemini-3.5-flash-lite"));
    const state = serve({ vision_source: "chat_model" });
    renderCard();
    const radio = await screen.findByRole("radio", { name: LOCAL });
    await userEvent.click(radio);
    await waitFor(() => expect(state.puts).toEqual([{ vision_source: "local" }]));
  });

  it("shows the privacy note for the cloud sources only", async () => {
    serve({ vision_source: "local" });
    const first = renderCard();
    await screen.findByRole("radio", { name: LOCAL });
    expect(screen.queryByText(/are sent to the provider you choose/)).not.toBeInTheDocument();
    first.unmount();
    serve({ vision_source: "cloud_model" });
    renderCard();
    expect(await screen.findByText(/are sent to the provider you choose/)).toBeInTheDocument();
  });

  it("cloud model: the form saves nothing until Save, then one PUT with the key", async () => {
    const state = serve();
    renderCard();
    await userEvent.click(await screen.findByRole("radio", { name: CLOUD }));
    expect(state.puts).toEqual([]);
    const save = screen.getByRole("button", { name: "Save cloud vision" });
    expect(save).toBeDisabled();

    await userEvent.click(screen.getByRole("combobox", { name: "Vision provider" }));
    await userEvent.click(await screen.findByRole("option", { name: "Google Gemini" }));
    // The first vision model of the provider is preselected.
    expect(await screen.findByRole("combobox", { name: "Cloud vision model" })).toHaveTextContent(
      "gemini-3.5-flash-lite"
    );
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("API key"), "sk-secret-123");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(state.puts).toEqual([
        {
          vision_source: "cloud_model",
          vision_cloud_preset: "gemini",
          vision_cloud_model: "gemini-3.5-flash-lite",
          vision_cloud_use_chat_key: false,
          vision_cloud_api_key: "sk-secret-123"
        }
      ])
    );
  });

  it("cloud model: the model list is filtered to vision-capable models", async () => {
    serve({ vision_source: "cloud_model", vision_cloud_preset: "deepseek", vision_cloud_model: "deepseek-flash" });
    renderCard();
    await userEvent.click(await screen.findByRole("combobox", { name: "Cloud vision model" }));
    expect(await screen.findByRole("option", { name: "deepseek-flash" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "deepseek-v4-pro" })).not.toBeInTheDocument();
  });

  it("cloud model: the Test button checks the typed key and never echoes it", async () => {
    serve({ vision_source: "cloud_model", vision_cloud_preset: "gemini", vision_cloud_model: "gemini-3.5-flash-lite" });
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/llm/provider/test`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true, error_code: null, models: ["a", "b"], recommended: [] });
      })
    );
    renderCard();
    const test = await screen.findByRole("button", { name: "Test" });
    expect(test).toBeDisabled();
    await userEvent.type(screen.getByLabelText("API key"), "sk-secret-123");
    await userEvent.click(test);
    expect(await screen.findByText("Key works: 2 models available")).toBeInTheDocument();
    expect(bodies).toEqual([
      { preset: "gemini", api_key: "sk-secret-123", check_chat: true, model: "gemini-3.5-flash-lite" }
    ]);
    expect(document.body.textContent).not.toContain("sk-secret-123");
  });

  it("cloud model: can reuse the chat provider key of the same provider", async () => {
    server.use(cloud("gemini-3.5-flash-lite"));
    const state = serve({
      vision_source: "cloud_model",
      vision_cloud_preset: "gemini",
      vision_cloud_model: "gemini-3.5-flash-lite"
    });
    renderCard();
    const checkbox = await screen.findByRole("switch", { name: "Use my chat provider key" });
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save cloud vision" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(state.puts).toEqual([
        {
          vision_source: "cloud_model",
          vision_cloud_preset: "gemini",
          vision_cloud_model: "gemini-3.5-flash-lite",
          vision_cloud_use_chat_key: true
        }
      ])
    );
  });

  it("does not offer the chat key checkbox when no chat profile uses that provider", async () => {
    serve({ vision_source: "cloud_model", vision_cloud_preset: "gemini", vision_cloud_model: "gemini-3.5-flash-lite" });
    renderCard();
    await screen.findByLabelText("API key");
    expect(screen.queryByRole("switch", { name: "Use my chat provider key" })).not.toBeInTheDocument();
  });

  it("enables the chat model for NVIDIA NIM with nvidia/nemotron-3.5-super-vl-120b-a12b", async () => {
    server.use(cloud("nvidia/nemotron-3.5-super-vl-120b-a12b", "nvidia_nim"));
    const state = serve();
    renderCard();
    const radio = await screen.findByRole("radio", { name: CHAT });
    await waitFor(() => expect(radio).toBeEnabled());
    await userEvent.click(radio);
    await waitFor(() => expect(state.puts).toEqual([{ vision_source: "chat_model" }]));
  });

  it("cloud model: lists NVIDIA NIM as a vision provider and preselects its vision model", async () => {
    serve();
    renderCard();
    await userEvent.click(await screen.findByRole("radio", { name: CLOUD }));
    await userEvent.click(screen.getByRole("combobox", { name: "Vision provider" }));
    await userEvent.click(await screen.findByRole("option", { name: "NVIDIA NIM" }));
    expect(await screen.findByRole("combobox", { name: "Cloud vision model" })).toHaveTextContent(
      "nvidia/nemotron-3.5-super-vl-120b-a12b"
    );
  });

  it("speaks neutral Spanish", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve();
    renderCard();
    expect(await screen.findByRole("radio", { name: /En esta PC \(necesita GPU\)/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Tu modelo seleccionado en la pestaña de Modelos/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Otro modelo en la nube/ })).toBeInTheDocument();
  });
});

describe("VisionCard segmented layout and custom radio styling", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("organizes controls into three user-friendly sections in English and Spanish", async () => {
    serve({ enabled: true });
    const view = renderCard();
    expect(await screen.findByRole("region", { name: "When does Kira look?" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Vision engine (Local vs. Cloud)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Privacy and capture frequency" })).toBeInTheDocument();
    view.unmount();

    useUiLocaleStore.setState({ locale: "es" });
    serve({ enabled: true });
    renderCard();
    expect(await screen.findByRole("region", { name: "¿Cuándo mira Kira?" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Motor de visión (Local vs. Nube)" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Privacidad y frecuencia" })).toBeInTheDocument();
  });

  it("renders custom-styled radio cards without native visible radio chrome or harsh white borders", async () => {
    serve({ vision_source: "local" });
    const { container } = renderCard();
    const localRadio = await screen.findByRole("radio", { name: /On this PC \(needs a GPU\)/ });
    const cloudRadio = screen.getByRole("radio", { name: /Another cloud model/ });
    await waitFor(() => expect(localRadio).toBeEnabled());

    // Native radio input is visually hidden (sr-only) and wrapped in a styled card.
    expect(localRadio).toHaveClass("sr-only");
    const localCard = localRadio.closest("label");
    const cloudCard = cloudRadio.closest("label");
    expect(localCard).toHaveAttribute("data-selected", "true");
    expect(localCard?.className).toContain("bg-sky-500/10");
    expect(localCard?.className).toContain("border-sky-500/40");
    expect(cloudCard).toHaveAttribute("data-selected", "false");
    expect(cloudCard?.className).toContain("border-white/[0.06]");

    // Selecting another radio card transfers the active styling.
    await userEvent.click(cloudRadio);
    expect(cloudCard).toHaveAttribute("data-selected", "true");
    expect(cloudCard?.className).toContain("bg-sky-500/10");
    expect(localCard).toHaveAttribute("data-selected", "false");

    // No harsh border-white classes anywhere inside VisionCard.
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bborder-white(?![/\w-])/);
  });

  it("surfaces VisionValidationError field details instead of swallowing behind generic save error", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/vision`, () => HttpResponse.json({ ...BASE, enabled: false })),
      http.put(`${API_BASE_URL}/api/vision`, () =>
        HttpResponse.json(
          {
            detail: "invalid_vision_settings",
            errors: [{ field: "vision_cloud_api_key", code: "required" }]
          },
          { status: 422 }
        )
      )
    );
    renderCard();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable vision" })).toBeEnabled());
    await userEvent.click(screen.getByRole("switch", { name: "Enable vision" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/vision_cloud_api_key/);
    expect(alert).toHaveTextContent(/required/);
  });

  it("cloud model: switching preset clears draftUseChatKey so the next provider does not inherit the previous check", async () => {
    server.use(
      llmProviderGetHandler({
        ...defaultLlmProvider,
        active_provider: "gem",
        profiles: {
          gem: { base_url: "https://x/v1", model: "gemini-3.5-flash-lite", preset: "gemini", api_key_set: true },
          ds: { base_url: "https://y/v1", model: "deepseek-flash", preset: "deepseek", api_key_set: true }
        }
      })
    );
    serve({
      vision_source: "cloud_model",
      vision_cloud_preset: "gemini",
      vision_cloud_model: "gemini-3.5-flash-lite",
      vision_cloud_use_chat_key: true
    });
    renderCard();
    const checkbox = await screen.findByRole("switch", { name: "Use my chat provider key" });
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Vision provider" }));
    await userEvent.click(await screen.findByRole("option", { name: "DeepSeek" }));

    const nextCheckbox = await screen.findByRole("switch", { name: "Use my chat provider key" });
    expect(nextCheckbox).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
  });
});


function gemProvider(model = "gemini-3.5-flash-lite", preset = "gemini", extra: Record<string, unknown> = {}) {
  return llmProviderGetHandler({
    ...defaultLlmProvider,
    active_provider: "gem",
    profiles: { gem: { base_url: "https://x/v1", model, preset, api_key_set: true, ...extra } }
  });
}

describe("VisionCard redesign (vision-settings-redesign B3)", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("OFF: shows only the enable switch and one line, hiding everything else", async () => {
    serve({ enabled: false, vision_source: "cloud_model" });
    renderCard();
    expect(await screen.findByText("Kira is not looking at your screen and the VRAM is free.")).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: "Enable vision" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Screenshots stay in memory/)).not.toBeInTheDocument();
    expect(screen.queryByText("Frames per look")).not.toBeInTheDocument();
  });

  it("OFF: re-enabling sends only {enabled:true} and restores the previous engine", async () => {
    const state = serve({
      enabled: false,
      vision_source: "cloud_model",
      vision_cloud_preset: "gemini",
      vision_cloud_model: "gemini-3.5-flash-lite"
    });
    renderCard();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable vision" })).toBeEnabled());
    await userEvent.click(screen.getByRole("switch", { name: "Enable vision" }));
    await waitFor(() => expect(state.puts).toEqual([{ enabled: true }]));
    expect(await screen.findByRole("radio", { name: /Another cloud model/ })).toBeChecked();
    expect(screen.queryByText("Kira is not looking at your screen and the VRAM is free.")).not.toBeInTheDocument();
  });

  it("ON: the look guide is collapsed by default and expands on demand", async () => {
    serve();
    renderCard();
    const toggle = await screen.findByRole("button", { name: "How to ask for a look" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "How to ask for a look" })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "How to ask for a look" })).toBeInTheDocument();
  });

  it("renders only the pane of the selected engine", async () => {
    serve();
    renderCard();
    expect(await screen.findByRole("combobox", { name: "Vision model" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Vision provider" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Another cloud model/ }));
    expect(await screen.findByRole("combobox", { name: "Vision provider" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Vision model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Advanced" })).not.toBeInTheDocument();
  });

  it("local: downloads and Other model stay under a collapsed Advanced", async () => {
    serve();
    serveModels();
    renderCard();
    const adv = await screen.findByRole("button", { name: "Advanced" });
    expect(adv).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Suggested models" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Other model" })).not.toBeInTheDocument();
    await userEvent.click(adv);
    expect(await screen.findByRole("list", { name: "Suggested models" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Other model" })).toBeInTheDocument();
  });

  it("shows ONE status indicator: no header badge, status list only", async () => {
    serve({ status: { ...BASE.status, daemon_state: "running" } });
    renderCard();
    await screen.findByText("Vision engine: running");
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Model status:/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("list", { name: "Vision status" })).toHaveLength(1);
  });

  it("cloud engines hide the local engine rows of the status list", async () => {
    serve({ vision_source: "cloud_model" });
    renderCard();
    await screen.findByRole("combobox", { name: "Vision provider" });
    expect(screen.queryByText(/Vision engine:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Screen capture available")).not.toBeInTheDocument();
  });

  describe("chat model pane", () => {
    it("summarizes the configured provider read-only, with a link to the provider card", async () => {
      server.use(gemProvider());
      serve({ vision_source: "chat_model", chat_model_eligible: true, chat_model_reason: null });
      renderCard();
      expect(await screen.findByText("Google Gemini")).toBeInTheDocument();
      expect(screen.getByText("gemini-3.5-flash-lite")).toBeInTheDocument();
      expect(screen.getByText("Sees images")).toBeInTheDocument();
      expect(screen.getByText("key saved")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change in provider settings" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Vision model" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Vision provider" })).not.toBeInTheDocument();
    });

    it("the link scrolls to and focuses the provider card", async () => {
      server.use(gemProvider());
      serve({ vision_source: "chat_model", chat_model_eligible: true, chat_model_reason: null });
      const target = document.createElement("div");
      target.id = "provider-card";
      target.tabIndex = -1;
      const scroll = vi.fn();
      target.scrollIntoView = scroll;
      document.body.appendChild(target);
      try {
        renderCard();
        await userEvent.click(await screen.findByRole("button", { name: "Change in provider settings" }));
        expect(scroll).toHaveBeenCalled();
        expect(target).toHaveFocus();
      } finally {
        target.remove();
      }
    });

    it("not vision capable: one reason line and an inline sees-images switch that saves model_vision", async () => {
      const bodies: unknown[] = [];
      let visionGets = 0;
      server.use(
        gemProvider("my-model", ""),
        http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json(defaultLlmProvider);
        })
      );
      const state = serve({
        vision_source: "chat_model",
        chat_model_eligible: false,
        chat_model_reason: "chat_model_not_vision_capable"
      });
      server.use(
        http.get(`${API_BASE_URL}/api/vision`, () => {
          visionGets += 1;
          return HttpResponse.json(state.current);
        })
      );
      renderCard();
      expect(await screen.findByText(/Your model from Models does not see images/)).toBeInTheDocument();
      const sw = await screen.findByRole("switch", { name: "This model sees images" });
      expect(sw).toHaveAttribute("aria-checked", "false");
      const before = visionGets;
      await userEvent.click(sw);
      await waitFor(() => expect(bodies).toEqual([{ profile_id: "gem", model_vision: true }]));
      await waitFor(() => expect(visionGets).toBeGreaterThan(before));
    });

    it("requires a cloud provider: one reason line, no inline switch", async () => {
      serve({
        vision_source: "chat_model",
        chat_model_eligible: false,
        chat_model_reason: "chat_model_requires_cloud_provider"
      });
      renderCard();
      expect(await screen.findByText("Needs a cloud provider as the active provider.")).toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "This model sees images" })).not.toBeInTheDocument();
    });

    it("shows a checking state while the provider loads, not the cloud-provider warning", async () => {
      server.use(
        http.get(`${API_BASE_URL}/api/llm/provider`, async () => {
          await delay(150);
          return HttpResponse.json(defaultLlmProvider);
        })
      );
      serve({ vision_source: "chat_model" });
      renderCard();
      expect(await screen.findByText("Checking your chat provider…")).toBeInTheDocument();
      expect(screen.queryByText("Needs a cloud provider as the active provider.")).not.toBeInTheDocument();
      expect(await screen.findByText("Needs a cloud provider as the active provider.")).toBeInTheDocument();
      expect(screen.queryByText("Checking your chat provider…")).not.toBeInTheDocument();
    });

    it("shows a distinct line when the provider cannot be read", async () => {
      server.use(llmProviderGetErrorHandler());
      serve({ vision_source: "chat_model" });
      renderCard();
      expect(await screen.findByText("Could not read your chat provider.")).toBeInTheDocument();
      expect(screen.queryByText("Needs a cloud provider as the active provider.")).not.toBeInTheDocument();
    });

    it("keeps the cloud-provider warning out of the option hints", async () => {
      serve();
      renderCard();
      await screen.findByRole("radio", { name: /Another cloud model/ });
      expect(screen.queryByText("Needs a cloud provider as the active provider.")).not.toBeInTheDocument();
    });
  });

  describe("model-from-Models option (live subtitle)", () => {
    it("is titled 'Your model from Models' and names the provider and model selected in Models", async () => {
      server.use(gemProvider());
      serve({ vision_source: "local", chat_model_eligible: true, chat_model_reason: null });
      renderCard();
      expect(await screen.findByRole("radio", { name: /Your model selected in the Models tab/ })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: /The chat model/ })).not.toBeInTheDocument();
      expect(await screen.findByText("Google Gemini · gemini-3.5-flash-lite")).toBeInTheDocument();
    });

    it("local provider: shows the Ollama model and that it cannot see images", async () => {
      server.use(
        http.get(`${API_BASE_URL}/api/status`, () =>
          HttpResponse.json({ ...defaultStatus, current_model: "gemma4:e4b" })
        )
      );
      serve({ vision_source: "local" });
      renderCard();
      expect(await screen.findByText("Ollama · gemma4:e4b · cannot see images")).toBeInTheDocument();
    });

    it("while the provider loads shows the checking line", async () => {
      server.use(
        http.get(`${API_BASE_URL}/api/llm/provider`, async () => {
          await delay(150);
          return HttpResponse.json(defaultLlmProvider);
        })
      );
      serve({ vision_source: "local" });
      renderCard();
      expect(await screen.findByText("Checking your chat provider…")).toBeInTheDocument();
    });
  });

  describe("suggestion line", () => {
    it("local + eligible chat model: suggests it, the button switches (no auto-switch)", async () => {
      const state = serve({ vision_source: "local", chat_model_eligible: true, chat_model_reason: null });
      renderCard();
      expect(await screen.findByText(/Your model from Models can see images/)).toBeInTheDocument();
      expect(state.puts).toEqual([]);
      await userEvent.click(screen.getByRole("button", { name: "Use my model from Models" }));
      await waitFor(() => expect(state.puts).toEqual([{ vision_source: "chat_model" }]));
    });

    it("is not shown when the chat model is not eligible or the source is not local", async () => {
      serve({
        vision_source: "local",
        chat_model_eligible: false,
        chat_model_reason: "chat_model_requires_cloud_provider"
      });
      const first = renderCard();
      await screen.findByRole("combobox", { name: "Vision model" });
      expect(screen.queryByText(/Your model from Models can see images/)).not.toBeInTheDocument();
      first.unmount();
      serve({ vision_source: "cloud_model", chat_model_eligible: true, chat_model_reason: null });
      renderCard();
      await screen.findByRole("combobox", { name: "Vision provider" });
      expect(screen.queryByText(/Your model from Models can see images/)).not.toBeInTheDocument();
    });
  });

  describe("VRAM advisory", () => {
    it("insufficient: shows the numbers and suggests another cloud model", async () => {
      serve({ vram_warning: "insufficient", vram_needed_gib: 7.5, vram_free_gib: 3.2, vram_total_gib: 12 });
      renderCard();
      const note = await screen.findByText(/Not enough free VRAM/);
      expect(note).toHaveTextContent("7.5");
      expect(note).toHaveTextContent("3.2");
      expect(note).toHaveTextContent("Another cloud model");
    });

    it("unknown: shows a subtle note", async () => {
      serve({ vram_warning: "unknown", vram_needed_gib: 7.5, vram_free_gib: null, vram_total_gib: null });
      renderCard();
      expect(await screen.findByText(/could not measure the free VRAM/i)).toBeInTheDocument();
    });

    it("no warning when the backend reports none or the source is not local", async () => {
      serve({ vram_warning: null });
      const first = renderCard();
      await screen.findByRole("combobox", { name: "Vision model" });
      expect(screen.queryByText(/VRAM/i)).not.toBeInTheDocument();
      first.unmount();
      serve({
        vision_source: "cloud_model",
        vram_warning: "insufficient",
        vram_needed_gib: 7.5,
        vram_free_gib: 3.2,
        vram_total_gib: 12
      });
      renderCard();
      await screen.findByRole("combobox", { name: "Vision provider" });
      expect(screen.queryByText(/Not enough free VRAM/)).not.toBeInTheDocument();
    });
  });

  it("maps a 422 chat-model rejection to a readable reason", async () => {
    server.use(
      gemProvider(),
      http.get(`${API_BASE_URL}/api/vision`, () =>
        HttpResponse.json({ ...BASE, chat_model_eligible: true, chat_model_reason: null })
      ),
      http.put(`${API_BASE_URL}/api/vision`, () =>
        HttpResponse.json(
          { detail: "invalid_vision_settings", errors: [{ field: "vision_source", code: "chat_model_not_vision_capable" }] },
          { status: 422 }
        )
      )
    );
    renderCard();
    const radio = await screen.findByRole("radio", { name: /Your model selected in the Models tab/ });
    await waitFor(() => expect(radio).toBeEnabled());
    await userEvent.click(radio);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your model from Models does not see images");
    expect(alert).not.toHaveTextContent("chat_model_not_vision_capable");
  });

  it("cloud model: preselects the active provider, its vision model and the chat key", async () => {
    server.use(gemProvider());
    const state = serve({ vision_source: "cloud_model" });
    renderCard();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Vision provider" })).toHaveTextContent("Google Gemini")
    );
    expect(screen.getByRole("combobox", { name: "Cloud vision model" })).toHaveTextContent("gemini-3.5-flash-lite");
    const key = screen.getByRole("switch", { name: "Use my chat provider key" });
    expect(key).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/are sent to the provider you choose/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save cloud vision" });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(state.puts).toEqual([
        {
          vision_source: "cloud_model",
          vision_cloud_preset: "gemini",
          vision_cloud_model: "gemini-3.5-flash-lite",
          vision_cloud_use_chat_key: true
        }
      ])
    );
  });

  it("cloud model: a saved preset wins over the active provider", async () => {
    server.use(gemProvider());
    serve({ vision_source: "cloud_model", vision_cloud_preset: "deepseek", vision_cloud_model: "deepseek-flash" });
    renderCard();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Vision provider" })).toHaveTextContent("DeepSeek")
    );
  });

  it("speaks Spanish in the OFF state", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve({ enabled: false });
    renderCard();
    expect(await screen.findByText("Kira no mira tu pantalla y la VRAM queda libre.")).toBeInTheDocument();
  });
});
