import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultTtsConfig } from "../../test/handlers.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { initialSetupState } from "./setupMachine.js";
import { TTS_CONFIG_POLL, VoiceStep, type VoicePart } from "./VoiceStep.js";

const PIPER = "Voz en tu PC (Piper, sin internet)";
const EDGE = "Voz en línea (Edge, de Microsoft, necesita internet)";

/** Backend double: commands mutate the TTS config, and every command/say is logged in order. */
function fakeBackend(initial: Partial<typeof defaultTtsConfig> = {}) {
  const config = { ...defaultTtsConfig, ...initial };
  const log: string[] = [];
  server.use(
    http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(config)),
    http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
      const body = (await request.json()) as { command: string; payload: { value: unknown } };
      log.push(`cmd:${body.command}=${String(body.payload.value)}`);
      if (body.command === "set_tts_local_only") config.local_only = body.payload.value as boolean;
      if (body.command === "set_tts_speed") config.speed = body.payload.value as number;
      if (body.command === "set_piper_voice") config.piper_voice = body.payload.value as string;
      return HttpResponse.json({ accepted: true, command_id: "c", status: "queued", state_version: 2 });
    }),
    http.post(`${API_BASE_URL}/api/speech/say`, async ({ request }) => {
      log.push(`say:${((await request.json()) as { text: string }).text}`);
      return HttpResponse.json({ job_id: 1 });
    })
  );
  return log;
}

/**
 * One screen of the voice block. `show` moves to another screen the way the flow
 * does: the same component stays mounted, so queued changes survive the move.
 */
function renderStep(part: VoicePart = "kind", state = initialSetupState()) {
  const dispatch = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: VoicePart) => (
    <QueryClientProvider client={queryClient}>
      <VoiceStep part={next} state={state} dispatch={dispatch} />
    </QueryClientProvider>
  );
  const view = render(ui(part));
  return Object.assign(dispatch, { show: (next: VoicePart) => view.rerender(ui(next)) });
}

beforeEach(() => {
  window.localStorage.clear();
  useUiLocaleStore.getState().setLocale("es");
});

describe("VoiceStep — one decision per screen", () => {
  it("kind screen shows only the voice kind; speed screen only the speed; test screen only the test line", async () => {
    fakeBackend();
    const view = renderStep("kind");
    await waitFor(() => expect(screen.getByRole("button", { name: PIPER })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Lenta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reproducir voz de prueba" })).not.toBeInTheDocument();
    view.show("speed");
    expect(screen.getByRole("button", { name: "Lenta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PIPER })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reproducir voz de prueba" })).not.toBeInTheDocument();
    view.show("test");
    expect(screen.getByRole("button", { name: "Reproducir voz de prueba" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PIPER })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lenta" })).not.toBeInTheDocument();
  });
});

describe("VoiceStep — voice kind and speed", () => {
  it("shows the current voice and applies the other one through set_tts_local_only", async () => {
    const log = fakeBackend();
    renderStep();
    await waitFor(() => expect(screen.getByRole("button", { name: PIPER })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: EDGE })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: EDGE }));
    expect(screen.getByRole("button", { name: EDGE })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(log).toContain("cmd:set_tts_local_only=false"));
  });

  it("shows the current speed and applies another one through set_tts_speed", async () => {
    const log = fakeBackend();
    renderStep("speed");
    await waitFor(() => expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true"));
    for (const name of ["Rápida", "Tranquila", "Lenta"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Lenta" }));
    await waitFor(() => expect(log).toContain("cmd:set_tts_speed=1.45"));
  });

  it("disables Piper with a one-line reason when it is not installed", async () => {
    fakeBackend({ piper_available: false, local_only: false });
    renderStep();
    expect(await screen.findByText("Piper no está instalado en este equipo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PIPER })).toBeDisabled();
    expect(screen.getByRole("button", { name: EDGE })).toHaveAttribute("aria-pressed", "true");
  });

  it("plays the test line only after the chosen settings are applied", async () => {
    const log = fakeBackend();
    const view = renderStep("kind");
    await waitFor(() => expect(screen.getByRole("button", { name: EDGE })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: EDGE }));
    view.show("speed");
    fireEvent.click(screen.getByRole("button", { name: "Lenta" }));
    view.show("test");
    fireEvent.click(screen.getByRole("button", { name: "Reproducir voz de prueba" }));
    await waitFor(() => expect(log.some((entry) => entry.startsWith("say:"))).toBe(true));
    expect(log).toEqual([
      "cmd:set_tts_local_only=false",
      "cmd:set_tts_speed=1.45",
      "say:Hola, soy Kira. Si me escuchas, la voz funciona."
    ]);
  });

  it("keeps the did-you-hear-it question after the test line", async () => {
    fakeBackend();
    const dispatch = renderStep("test");
    fireEvent.click(screen.getByRole("button", { name: "Reproducir voz de prueba" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sí, te escucho" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "voiceResult", heard: true });
  });
});

describe("VoiceStep — review fixes (S8)", () => {
  const poll = { ...TTS_CONFIG_POLL };
  afterEach(() => {
    Object.assign(TTS_CONFIG_POLL, poll);
  });

  it("keeps the choices disabled and unpressed until the voice settings load", async () => {
    fakeBackend();
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, async () => {
        await delay(80);
        return HttpResponse.json(defaultTtsConfig);
      })
    );
    const view = renderStep("kind");
    for (const name of [PIPER, EDGE]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
    await waitFor(() => expect(screen.getByRole("button", { name: PIPER })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: EDGE })).toBeEnabled();
    view.show("speed");
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
  });

  it("never shows Piper pressed while it is disabled", async () => {
    fakeBackend({ piper_available: false, local_only: true });
    renderStep();
    await waitFor(() => expect(screen.getByRole("button", { name: PIPER })).toBeDisabled());
    await waitFor(() => expect(screen.getByRole("button", { name: EDGE })).toBeEnabled());
    expect(screen.getByRole("button", { name: PIPER })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the apply error and does not play the test line when the change never shows up", async () => {
    TTS_CONFIG_POLL.intervalMs = 1;
    TTS_CONFIG_POLL.attempts = 3;
    const log: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(defaultTtsConfig)),
      http.post(`${API_BASE_URL}/api/commands`, () => HttpResponse.json({ accepted: true, command_id: "c", status: "queued", state_version: 2 })),
      http.post(`${API_BASE_URL}/api/speech/say`, () => {
        log.push("say");
        return HttpResponse.json({ job_id: 1 });
      })
    );
    const view = renderStep("kind");
    await waitFor(() => expect(screen.getByRole("button", { name: EDGE })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: EDGE }));
    view.show("test");
    fireEvent.click(screen.getByRole("button", { name: "Reproducir voz de prueba" }));
    expect(await screen.findByText(/No pude cambiar eso ahora/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(log).toEqual([]);
  });

  it("scrolls the did-you-hear-me question into view when it appears", async () => {
    fakeBackend();
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      renderStep("test");
      fireEvent.click(screen.getByRole("button", { name: "Reproducir voz de prueba" }));
      await screen.findByText("¿Me escuchaste?");
      await waitFor(() => expect(scroll).toHaveBeenCalled());
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("says voice stays off only during this setup when the user hears nothing", async () => {
    fakeBackend();
    renderStep("test", { ...initialSetupState(), step: "voiceTest", voice: "off" });
    expect(screen.getByText(/silencia solo la guía de Kira durante esta configuración/)).toBeInTheDocument();
    expect(screen.getByText(/Controles › Voz/)).toBeInTheDocument();
  });
});

describe("VoiceStep — loading & error feedback (S3)", () => {
  const poll = { ...TTS_CONFIG_POLL };
  afterEach(() => {
    Object.assign(TTS_CONFIG_POLL, poll);
  });

  it("shows a spinner and applying status while waiting for a voice option change to settle", async () => {
    let releaseCommand!: () => void;
    const commandGate = new Promise<void>((resolve) => { releaseCommand = resolve; });
    const config = { ...defaultTtsConfig, local_only: true };
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(config)),
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        await commandGate;
        const body = (await request.json()) as { command: string; payload: { value: unknown } };
        if (body.command === "set_tts_local_only") config.local_only = body.payload.value as boolean;
        return HttpResponse.json({ accepted: true, command_id: "c", status: "queued", state_version: 2 });
      })
    );
    renderStep("kind");
    const edgeBtn = await screen.findByRole("button", { name: EDGE });
    await waitFor(() => expect(edgeBtn).toBeEnabled());

    fireEvent.click(edgeBtn);
    expect(edgeBtn).toHaveAttribute("aria-pressed", "true");
    expect(edgeBtn.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Aplicando/);

    releaseCommand();
    await waitFor(() => expect(edgeBtn.querySelector("svg.animate-spin")).toBeNull());
    expect(screen.queryByText(/Aplicando/)).not.toBeInTheDocument();
  });

  it("shows applying feedback on speed buttons while pending and surfaces timeout reason", async () => {
    TTS_CONFIG_POLL.intervalMs = 1;
    TTS_CONFIG_POLL.attempts = 2;
    let releaseCommand!: () => void;
    const commandGate = new Promise<void>((resolve) => { releaseCommand = resolve; });
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(defaultTtsConfig)),
      http.post(`${API_BASE_URL}/api/commands`, async () => {
        await commandGate;
        return HttpResponse.json({ accepted: true, command_id: "c", status: "queued", state_version: 2 });
      })
    );
    renderStep("speed");
    const slowBtn = await screen.findByRole("button", { name: "Lenta" });
    await waitFor(() => expect(slowBtn).toBeEnabled());
    fireEvent.click(slowBtn);
    expect(slowBtn.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Aplicando/);

    releaseCommand();
    expect(await screen.findByText(/No pude cambiar eso ahora/)).toBeInTheDocument();
    expect(screen.getByText(/no confirmó el cambio a tiempo/i)).toBeInTheDocument();
  });

  it("shows a spinner on Play test voice while speech synthesis/playback is pending", async () => {
    let releaseSay!: () => void;
    const sayGate = new Promise<void>((resolve) => { releaseSay = resolve; });
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(defaultTtsConfig)),
      http.post(`${API_BASE_URL}/api/speech/say`, async () => {
        await sayGate;
        return HttpResponse.json({ job_id: 1 });
      })
    );
    renderStep("test");
    fireEvent.click(screen.getByRole("button", { name: "Reproducir voz de prueba" }));

    const playingBtn = await screen.findByRole("button", { name: "Reproduciendo…" });
    expect(playingBtn).toBeDisabled();
    expect(playingBtn.querySelector("svg.animate-spin")).not.toBeNull();

    releaseSay();
    expect(await screen.findByText("¿Me escuchaste?")).toBeInTheDocument();
  });
});
