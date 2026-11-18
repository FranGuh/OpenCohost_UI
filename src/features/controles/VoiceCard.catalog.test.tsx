import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  defaultI18nState,
  defaultTtsConfig,
  frozenStatusHandler,
  i18nStateHandler
} from "../../test/handlers.js";
import { useEventStore } from "../../store/eventStore.js";
import { VoiceCard } from "./VoiceCard.js";

const pickFolder = vi.fn<(defaultPath?: string) => Promise<string | null>>();
vi.mock("../../lib/pickFolder.js", () => ({
  pickFolder: (defaultPath?: string) => pickFolder(defaultPath)
}));

const OK_VOICE = {
  id: "es_MX-claude-high.onnx",
  label: "Claude (es_MX)",
  lang: "es",
  num_speakers: 1,
  speakers: [],
  sample_rate: 22050,
  bundled: true,
  status: "ok",
  reason: null
};
const MULTI_VOICE = {
  id: "es_AR-multi.onnx",
  label: "Multi (es_AR)",
  lang: "es",
  num_speakers: 2,
  speakers: [
    { name: "Ana", id: 0 },
    { name: "Beto", id: 1 }
  ],
  sample_rate: 22050,
  bundled: false,
  status: "ok",
  reason: null
};
const BROKEN_VOICE = {
  id: "es_ES-broken.onnx",
  label: "Broken (es_ES)",
  lang: "es",
  num_speakers: 1,
  speakers: [],
  sample_rate: null,
  bundled: false,
  status: "incomplete",
  reason: "missing_config"
};

function piperConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...defaultTtsConfig,
    piper_voice: OK_VOICE.id,
    piper_voice_id: OK_VOICE.id,
    piper_speaker_id: null,
    piper_switch_failure_reason: null,
    edge_voice: "es-MX-DaliaNeural",
    edge_voice_failure_reason: null,
    ...overrides
  };
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(VoiceCard))
  );
}

function piperVoices(voices: unknown[], seen?: (lang: string | null) => void) {
  return http.get(`${API_BASE_URL}/api/tts/piper/voices`, ({ request }) => {
    seen?.(new URL(request.url).searchParams.get("lang"));
    return HttpResponse.json(voices);
  });
}

function pushFailure(action: string) {
  act(() => {
    useEventStore.getState().append({
      id: `evt-${action}-${Math.random()}`,
      ts: Date.now(),
      source: "motor",
      action,
      label: "failed",
      tone: "danger"
    });
  });
}

beforeEach(() => {
  pickFolder.mockReset();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  useEventStore.setState({ events: [] });
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("VoiceCard Piper catalog", () => {
  it("lists the catalog filtered by the active backend locale", async () => {
    const langs: Array<string | null> = [];
    server.use(
      i18nStateHandler({ ...defaultI18nState, active_locale: "en" }),
      piperVoices([{ ...OK_VOICE, id: "en_US-amy.onnx", label: "Amy (en_US)", lang: "en" }], (l) => langs.push(l)),
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json(piperConfig({ piper_voice: "en_US-amy.onnx", piper_voice_id: "en_US-amy.onnx" }))
      )
    );
    renderCard();
    const select = await screen.findByRole("combobox", { name: "Voz (Piper)" });
    await waitFor(() => expect(select).toHaveTextContent("Amy (en_US)"));
    expect(langs.every((l) => l === "en")).toBe(true);
    expect(langs.length).toBeGreaterThan(0);
  });

  it("shows an incomplete voice as a disabled option with its reason", async () => {
    server.use(
      piperVoices([OK_VOICE, BROKEN_VOICE]),
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(piperConfig()))
    );
    renderCard();
    const select = await screen.findByRole("combobox", { name: "Voz (Piper)" });
    await waitFor(() => expect(select).toHaveTextContent("Claude (es_MX)"));
    fireEvent.click(select);
    const option = screen.getByRole("option", { name: /Broken \(es_ES\)/ });
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).toHaveTextContent("falta el .onnx.json");
  });

  it("shows the speaker select only for a multi-speaker voice, with speaker names", async () => {
    server.use(
      piperVoices([OK_VOICE, MULTI_VOICE]),
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(piperConfig()))
    );
    renderCard();
    const voice = await screen.findByRole("combobox", { name: "Voz (Piper)" });
    await waitFor(() => expect(voice).toHaveTextContent("Claude (es_MX)"));
    expect(screen.queryByRole("combobox", { name: "Hablante" })).not.toBeInTheDocument();
  });

  it("renders the speaker select with names when the active voice has several speakers", async () => {
    server.use(
      piperVoices([OK_VOICE, MULTI_VOICE]),
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json(piperConfig({ piper_voice: MULTI_VOICE.id, piper_voice_id: MULTI_VOICE.id, piper_speaker_id: 1 }))
      )
    );
    renderCard();
    const speaker = await screen.findByRole("combobox", { name: "Hablante" });
    await waitFor(() => expect(speaker).toHaveTextContent("Beto"));
  });

  it("dispatches set_piper_voice with the chosen id and locks voice, speaker and folder buttons while pending", async () => {
    let body: unknown;
    let configVoice = OK_VOICE.id;
    server.use(
      frozenStatusHandler(1),
      piperVoices([OK_VOICE, MULTI_VOICE]),
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json(piperConfig({ piper_voice: configVoice, piper_voice_id: configVoice, piper_speaker_id: 0 }))
      ),
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "c1", status: "queued", state_version: 1 });
      })
    );
    renderCard();
    const voice = await screen.findByRole("combobox", { name: "Voz (Piper)" });
    await waitFor(() => expect(voice).toHaveTextContent("Claude (es_MX)"));
    fireEvent.click(voice);
    fireEvent.click(screen.getByRole("option", { name: "Multi (es_AR)" }));

    await waitFor(() =>
      expect(body).toEqual({ command: "set_piper_voice", payload: { value: MULTI_VOICE.id, speaker_id: 0 } })
    );
    // Accepted != applied: config still shows the old voice, so everything stays locked.
    await waitFor(() => expect(voice).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cambiar carpeta" })).toBeDisabled();
    expect(screen.getByText("Aplicando voz…")).toBeInTheDocument();

    configVoice = MULTI_VOICE.id;
    await waitFor(() => expect(voice).not.toBeDisabled(), { timeout: 4000 });
    expect(screen.getByRole("button", { name: "Cambiar carpeta" })).not.toBeDisabled();
  });

  it("locks the speaker select while a speaker switch is pending", async () => {
    let speakerId = 0;
    server.use(
      frozenStatusHandler(1),
      piperVoices([MULTI_VOICE]),
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json(
          piperConfig({ piper_voice: MULTI_VOICE.id, piper_voice_id: MULTI_VOICE.id, piper_speaker_id: speakerId })
        )
      ),
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "c2", status: "queued", state_version: 1 })
      )
    );
    renderCard();
    const speaker = await screen.findByRole("combobox", { name: "Hablante" });
    await waitFor(() => expect(speaker).toHaveTextContent("Ana"));
    fireEvent.click(speaker);
    fireEvent.click(screen.getByRole("option", { name: "Beto" }));
    await waitFor(() => expect(speaker).toBeDisabled());
    expect(screen.getByRole("combobox", { name: "Voz (Piper)" })).toBeDisabled();
    speakerId = 1;
    await waitFor(() => expect(speaker).not.toBeDisabled(), { timeout: 4000 });
  });

  it("clears pending on the failure event, shows the translated reason and keeps the previous voice", async () => {
    let reason: string | null = null;
    server.use(
      frozenStatusHandler(1),
      piperVoices([OK_VOICE, MULTI_VOICE]),
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json(piperConfig({ piper_switch_failure_reason: reason }))
      ),
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "c3", status: "queued", state_version: 1 })
      )
    );
    renderCard();
    const voice = await screen.findByRole("combobox", { name: "Voz (Piper)" });
    await waitFor(() => expect(voice).toHaveTextContent("Claude (es_MX)"));
    fireEvent.click(voice);
    fireEvent.click(screen.getByRole("option", { name: "Multi (es_AR)" }));
    await waitFor(() => expect(voice).toBeDisabled());

    reason = "load_failed";
    pushFailure("piper_voice_switch_failed");

    await waitFor(() => expect(voice).not.toBeDisabled());
    expect(voice).toHaveTextContent("Claude (es_MX)");
    const alert = await screen.findByText("No se pudo cargar la voz. Se mantiene la anterior.");
    expect(alert.closest("[role='alert']")).not.toBeNull();
  });

  it("shows an empty state when the folder has no usable voices", async () => {
    server.use(
      piperVoices([]),
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(piperConfig()))
    );
    renderCard();
    expect(await screen.findByText("No hay voces en esta carpeta.")).toBeInTheDocument();
  });

  it("shows a list error with a retry that refetches", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/piper/voices`, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ detail: "boom" }, { status: 500 }) : HttpResponse.json([OK_VOICE]);
      }),
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(piperConfig()))
    );
    renderCard();
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    fireEvent.click(retry);
    const voice = await screen.findByRole("combobox", { name: "Voz (Piper)" });
    await waitFor(() => expect(voice).toHaveTextContent("Claude (es_MX)"));
  });

  it("refetches the voice list after the folder changes and after reset", async () => {
    let calls = 0;
    let folder = { path: "C:\\piper", source: "default", exists: true, voice_count: 1 };
    server.use(
      http.get(`${API_BASE_URL}/api/tts/piper/voices`, () => {
        calls += 1;
        return HttpResponse.json([OK_VOICE]);
      }),
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(piperConfig())),
      http.get(`${API_BASE_URL}/api/tts/piper/folder`, () => HttpResponse.json(folder)),
      http.put(`${API_BASE_URL}/api/tts/piper/folder`, () => {
        folder = { path: "D:\\voices", source: "saved", exists: true, voice_count: 3 };
        return HttpResponse.json(folder);
      }),
      http.delete(`${API_BASE_URL}/api/tts/piper/folder`, () => {
        folder = { path: "C:\\piper", source: "default", exists: true, voice_count: 1 };
        return HttpResponse.json(folder);
      })
    );
    pickFolder.mockResolvedValue("D:\\voices");
    renderCard();
    await screen.findByTestId("piper-folder-path");
    await waitFor(() => expect(calls).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "Cambiar carpeta" }));
    await waitFor(() => expect(screen.getByTestId("piper-folder-path")).toHaveAttribute("title", "D:\\voices"));
    await waitFor(() => expect(calls).toBe(2));

    fireEvent.click(await screen.findByRole("button", { name: "Usar la predeterminada" }));
    await waitFor(() => expect(calls).toBe(3));
  });
});

describe("VoiceCard Edge catalog", () => {
  const EDGE = {
    voices: [
      { id: "es-MX-DaliaNeural", label: "Dalia", locale: "es-MX", gender: "Female" },
      { id: "es-MX-JorgeNeural", label: "Jorge", locale: "es-MX", gender: "Male" }
    ],
    source: "live"
  };

  function edgeHandlers(source = "live") {
    return [
      http.get(`${API_BASE_URL}/api/tts/edge/voices`, () => HttpResponse.json({ ...EDGE, source })),
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(piperConfig({ local_only: false })))
    ];
  }

  it("shows the Edge voice select (not Piper's) when local-only is off, and dispatches set_edge_voice", async () => {
    let body: unknown;
    server.use(
      frozenStatusHandler(1),
      ...edgeHandlers(),
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "c4", status: "queued", state_version: 1 });
      })
    );
    renderCard();
    const edge = await screen.findByRole("combobox", { name: "Voz (Edge-TTS)" });
    await waitFor(() => expect(edge).toHaveTextContent("Dalia"));
    expect(screen.queryByRole("combobox", { name: "Voz (Piper)" })).not.toBeInTheDocument();
    fireEvent.click(edge);
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /Jorge/ }));
    await waitFor(() =>
      expect(body).toEqual({ command: "set_edge_voice", payload: { value: "es-MX-JorgeNeural" } })
    );
    await waitFor(() => expect(edge).toBeDisabled());
  });

  it("shows an offline notice when the Edge list comes from the fallback", async () => {
    server.use(...edgeHandlers("fallback"));
    renderCard();
    expect(await screen.findByText("Sin conexión: se muestran las voces predeterminadas.")).toBeInTheDocument();
  });

  it("shows the translated reason when an Edge switch fails", async () => {
    let reason: string | null = null;
    server.use(
      frozenStatusHandler(1),
      http.get(`${API_BASE_URL}/api/tts/edge/voices`, () => HttpResponse.json(EDGE)),
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json(piperConfig({ local_only: false, edge_voice_failure_reason: reason }))
      ),
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "c5", status: "queued", state_version: 1 })
      )
    );
    renderCard();
    const edge = await screen.findByRole("combobox", { name: "Voz (Edge-TTS)" });
    await waitFor(() => expect(edge).toHaveTextContent("Dalia"));
    fireEvent.click(edge);
    fireEvent.click(screen.getByRole("option", { name: /Jorge/ }));
    await waitFor(() => expect(edge).toBeDisabled());
    reason = "edge_voice_unknown";
    pushFailure("edge_voice_switch_failed");
    await waitFor(() => expect(edge).not.toBeDisabled());
    expect(edge).toHaveTextContent("Dalia");
    expect(await screen.findByText("Esa voz de Edge-TTS no existe.")).toBeInTheDocument();
  });
});
