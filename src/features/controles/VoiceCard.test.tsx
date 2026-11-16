import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  commandConflictHandler,
  commandNetworkErrorHandler,
  commandValidationHandler,
  defaultTtsConfig,
  frozenStatusHandler
} from "../../test/handlers.js";
import { TTS_CONFIG_QUERY_KEY, type TtsConfig } from "../../api/tts.js";
import { useEventStore } from "../../store/eventStore.js";
import { VoiceCard } from "./VoiceCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(VoiceCard)))
  };
}

afterEach(() => {
  vi.useRealTimers();
});

function defaultCommandHandler() {
  return http.post(`${API_BASE_URL}/api/commands`, () =>
    HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 1 })
  );
}

describe("VoiceCard populates from GET /api/tts/config", () => {
  it("shows the live piper_voice, local-only, closest speed preset, and engine", async () => {
    renderCard();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveTextContent("🌎 Neutral")
    );
    expect(screen.getByRole("switch", { name: "Solo TTS local (Piper)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Descartar residuos al interrumpir" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Media" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Motor TTS" })).toHaveTextContent("Ligero (Edge-TTS)");
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded config", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("disables the Pesado engine option when heavy_available is false", async () => {
    renderCard();
    const motor = await screen.findByRole("combobox", { name: "Motor TTS" });
    await waitFor(() => expect(motor).toHaveTextContent("Ligero (Edge-TTS)"));
    fireEvent.click(motor);
    expect(screen.getByRole("option", { name: "Pesado (Heavy)" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("VoiceCard set_piper_voice — accepted -> poll -> applied", () => {
  it("dispatches set_piper_voice, disables only the select while applying", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST, matching the real single-dispatcher counter; convergence here
    // must come from the optimistic timer, not a state_version comparison.
    server.use(frozenStatusHandler(1));
    server.use(defaultCommandHandler());
    renderCard();

    const select = await screen.findByRole("combobox", { name: "Idioma" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "🌎 Neutral" }));

    expect(select).toHaveTextContent("🌎 Neutral");
    expect(select).toBeDisabled();
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    // independence — the other three controls stay enabled
    expect(screen.getByRole("switch", { name: "Solo TTS local (Piper)" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Media" })).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Motor TTS" })).not.toBeDisabled();

    await waitFor(() => expect(select).not.toBeDisabled());
  });
});

describe("VoiceCard set_tts_speed / set_tts_local_only / set_motor_tts — accepted -> poll -> applied", () => {
  it("dispatches set_tts_speed as the numeric length_scale for the chosen preset", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST, matching the real single-dispatcher counter; convergence here
    // must come from the optimistic timer, not a state_version comparison.
    server.use(frozenStatusHandler(1));
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-speed", status: "queued", state_version: 1 });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Lenta" }));
    expect(screen.getByRole("button", { name: "Lenta" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(capturedBody).toEqual({ command: "set_tts_speed", payload: { value: 1.45 } }));
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });

  it("keeps the requested local-only value applying until a fresh config confirms it", async () => {
    let configReads = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        // The first read after command acceptance still reflects the old
        // server value. Only the next fresh read confirms the queued change.
        return HttpResponse.json({
          ...defaultTtsConfig,
          local_only: configReads < 5
        });
      })
    );
    server.use(frozenStatusHandler(1));
    server.use(defaultCommandHandler());
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Guardando el modo de TTS local…")).toBeInTheDocument();

    // Neither an old cached value nor an early stale GET is a success signal.
    await waitFor(() => expect(configReads).toBeGreaterThanOrEqual(4), { timeout: 2_000 });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Guardando el modo de TTS local…")).toBeInTheDocument();

    expect(
      await screen.findByText("Ajuste guardado. Se aplicará en la próxima frase; esto no confirma que Piper esté listo.")
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("confirms enabling local-only mode only after a fresh matching config read", async () => {
    let configReads = 0;
    const idempotencyKeys: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        return HttpResponse.json({ ...defaultTtsConfig, local_only: configReads > 1 });
      }),
      http.post(`${API_BASE_URL}/api/commands`, ({ request }) => {
        idempotencyKeys.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({ accepted: true, command_id: `cmd-${idempotencyKeys.length}`, status: "queued", state_version: 1 });
      })
    );
    const view = renderCard();

    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    // Begin from the cloud setting, then request local-only mode.
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText(/Ajuste guardado\./)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).not.toBeDisabled();

    // A saved switch is ready for another intent, which must not reuse the
    // just-confirmed idempotency key.
    fireEvent.click(toggle);
    await waitFor(() => expect(idempotencyKeys).toHaveLength(2));
    expect(idempotencyKeys[1]).not.toBe(idempotencyKeys[0]);
    view.unmount();
  });

  it("restores server truth after a read error and reuses the intent key on retry", async () => {
    let configReads = 0;
    const idempotencyKeys: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        if (configReads === 2) return HttpResponse.json({ detail: "read failed" }, { status: 500 });
        return HttpResponse.json({ ...defaultTtsConfig, local_only: configReads < 4 });
      }),
      http.post(`${API_BASE_URL}/api/commands`, ({ request }) => {
        idempotencyKeys.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({ accepted: true, command_id: `cmd-${idempotencyKeys.length}`, status: "queued", state_version: 1 });
      })
    );
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    expect(await screen.findByText("No se pudo confirmar el ajuste leyendo la configuración del servidor.")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(await screen.findByText(/Ajuste guardado\./)).toBeInTheDocument();
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).not.toBe("");
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("surfaces a bounded timeout and restores the last confirmed config", async () => {
    let configReads = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        return HttpResponse.json({ ...defaultTtsConfig, local_only: true });
      }),
      defaultCommandHandler()
    );
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    expect(
      await screen.findByText(/El servidor aún no confirma el ajuste\./, {}, { timeout: 8_000 })
    ).toBeInTheDocument();
    expect(configReads).toBeLessThanOrEqual(21);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).not.toBeDisabled();
  }, 10000);

  it("aborts convergence reads and timers when the card unmounts", async () => {
    let pollReads = 0;
    let initialRead = true;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        if (initialRead) {
          initialRead = false;
          return HttpResponse.json({ ...defaultTtsConfig, local_only: true });
        }
        pollReads += 1;
        return HttpResponse.json({ ...defaultTtsConfig, local_only: true });
      }),
      defaultCommandHandler()
    );
    const view = renderCard();

    fireEvent.click(await screen.findByRole("switch", { name: "Solo TTS local (Piper)" }));
    await waitFor(() => expect(pollReads).toBe(1));
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(pollReads).toBe(1);
  });

  it("bounds a config read that never resolves, aborts it, and unlocks the switch", async () => {
    let pollReadStarted = false;
    let initialRead = true;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        if (initialRead) {
          initialRead = false;
          return HttpResponse.json({ ...defaultTtsConfig, local_only: true });
        }
        pollReadStarted = true;
        return new Promise(() => {});
      }),
      defaultCommandHandler()
    );
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    await waitFor(() => expect(pollReadStarted).toBe(true));
    expect(
      await screen.findByText(/El servidor aún no confirma el ajuste\./, {}, { timeout: 7_000 })
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).not.toBeDisabled();
  }, 9000);

  it("bounds a stalled command request and reuses its idempotency key on retry", async () => {
    let configReads = 0;
    let commandRequests = 0;
    const idempotencyKeys: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        return HttpResponse.json({ ...defaultTtsConfig, local_only: configReads === 1 });
      }),
      http.post(`${API_BASE_URL}/api/commands`, ({ request }) => {
        commandRequests += 1;
        idempotencyKeys.push(request.headers.get("Idempotency-Key") ?? "");
        if (commandRequests === 1) return new Promise(() => {});
        return HttpResponse.json({ accepted: true, command_id: "cmd-retry", status: "queued", state_version: 1 });
      })
    );
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    expect(await screen.findByText("No se pudo enviar el cambio de modo de TTS local.", {}, { timeout: 17000 })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).not.toBeDisabled();

    fireEvent.click(toggle);
    expect(await screen.findByText(/Ajuste guardado\./)).toBeInTheDocument();
    expect(commandRequests).toBe(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  }, 20000);

  it("dispatches set_motor_tts on engine change", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST, matching the real single-dispatcher counter; convergence here
    // must come from the optimistic timer, not a state_version comparison.
    server.use(frozenStatusHandler(1));
    // heavy_available:true so the Pesado engine option is selectable (the
    // custom ui/Select refuses clicks on a disabled option, unlike a native
    // <select> where fireEvent.change bypassed the disabled attribute).
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json({ ...defaultTtsConfig, heavy_available: true }))
    );
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-engine", status: "queued", state_version: 1 });
      })
    );
    renderCard();

    const select = await screen.findByRole("combobox", { name: "Motor TTS" });
    await waitFor(() => expect(select).toHaveTextContent("Ligero (Edge-TTS)"));
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "Pesado (Heavy)" }));

    expect(select).toHaveTextContent("Pesado (Heavy)");
    await waitFor(() => expect(capturedBody).toEqual({ command: "set_motor_tts", payload: { value: "pesado" } }));
    await waitFor(() => expect(select).not.toBeDisabled());
  });

  it("toggles set_discard_speech_residue and dispatches command", async () => {
    server.use(frozenStatusHandler(1));
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-residue", status: "queued", state_version: 1 });
      })
    );
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "Descartar residuos al interrumpir" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(capturedBody).toEqual({ command: "set_discard_speech_residue", payload: { value: true } })
    );
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });
});

describe("VoiceCard command errors surface honestly", () => {
  it("shows a 409 conflict alert", async () => {
    server.use(commandConflictHandler());
    renderCard();
    const select = await screen.findByRole("combobox", { name: "Idioma" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "🌎 Neutral" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
  });

  it("shows a 422 validation alert with the backend detail", async () => {
    server.use(commandValidationHandler("set_tts_speed requires a numeric value"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Lenta" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("set_tts_speed requires a numeric value")
    );
  });

  it("shows a network-error alert", async () => {
    server.use(commandNetworkErrorHandler());
    renderCard();
    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    expect(await screen.findByText("No se pudo enviar el cambio de modo de TTS local.")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).not.toBeDisabled();
  });
});

describe("VoiceCard heavy-TTS disclosure", () => {
  it("shows a note that reference-voice is experimental-gated and out of scope", async () => {
    renderCard();
    await screen.findByRole("combobox", { name: "Idioma" });
    expect(screen.getByText(/EXPERIMENTAL_HEAVY_TTS_ENABLED/)).toBeInTheDocument();
  });
});

describe("VoiceCard Piper & Edge-TTS status alerts", () => {
  it("renders a warning Alert when local_only is true and piper_available is false", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json({
          ...defaultTtsConfig,
          local_only: true,
          piper_available: false
        })
      )
    );
    renderCard();
    await waitFor(() =>
      expect(
        screen.getByText("Voz local (Piper) no disponible. Instala piper-tts o desactiva Solo TTS local.")
      ).toBeInTheDocument()
    );
    expect(screen.getByText("Voz local no disponible")).toBeInTheDocument();
  });

  it("says the voice file is missing, not the package, when piper_unavailable_reason is voice_file_missing", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json({
          ...defaultTtsConfig,
          local_only: true,
          piper_available: false,
          piper_unavailable_reason: "voice_file_missing"
        })
      )
    );
    renderCard();
    await waitFor(() =>
      expect(
        screen.getByText(
          "La voz local seleccionada no está instalada. Elige otra voz o reinstala OpenCohost."
        )
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/Instala piper-tts/)).not.toBeInTheDocument();
  });

  it("renders an info Alert when local_only is false and edge_tts_offline is true", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json({
          ...defaultTtsConfig,
          local_only: false,
          edge_tts_offline: true
        })
      )
    );
    renderCard();
    await waitFor(() =>
      expect(
        screen.getByText("Edge-TTS sin conexión; usando Piper local como respaldo.")
      ).toBeInTheDocument()
    );
    expect(screen.getByText("Edge-TTS sin conexión")).toBeInTheDocument();
  });

  it("does not render status alerts when Piper is available in local mode", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json({
          ...defaultTtsConfig,
          local_only: true,
          piper_available: true,
          edge_tts_offline: false
        })
      )
    );
    renderCard();
    await screen.findByRole("combobox", { name: "Idioma" });
    expect(
      screen.queryByText("Voz local (Piper) no disponible. Instala piper-tts o desactiva Solo TTS local.")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Edge-TTS sin conexión; usando Piper local como respaldo.")
    ).not.toBeInTheDocument();
  });
});

describe("VoiceCard optimistic rollback on command failure, rejection, or timeout", () => {
  it("rolls back applyVoice cache & select when POST /api/commands returns 409 even if background refetch fails", async () => {
    let configReads = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        if (configReads === 1) {
          return HttpResponse.json({ ...defaultTtsConfig, piper_voice: "english" });
        }
        return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
      }),
      commandConflictHandler()
    );

    const { queryClient } = renderCard();
    const select = await screen.findByRole("combobox", { name: "Idioma" });
    await waitFor(() => expect(select).toHaveTextContent("🇺🇸 English"));

    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "🌎 Neutral" }));
    expect(select).toHaveTextContent("🌎 Neutral");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
    expect(select).toHaveTextContent("🇺🇸 English");
    expect(select).not.toBeDisabled();
    expect(queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY)?.piper_voice).toBe("english");
    await waitFor(() => expect(configReads).toBeGreaterThanOrEqual(2));
  });

  it("rolls back applySpeed cache & pressed button when POST /api/commands returns 422", async () => {
    let configReads = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        if (configReads === 1) {
          return HttpResponse.json({ ...defaultTtsConfig, speed: 1.15 });
        }
        return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
      }),
      commandValidationHandler("set_tts_speed requires a numeric value")
    );

    const { queryClient } = renderCard();
    const mediumBtn = await screen.findByRole("button", { name: "Media" });
    expect(mediumBtn).toHaveAttribute("aria-pressed", "true");

    const slowBtn = screen.getByRole("button", { name: "Lenta" });
    fireEvent.click(slowBtn);
    expect(slowBtn).toHaveAttribute("aria-pressed", "true");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("set_tts_speed requires a numeric value")
    );
    expect(slowBtn).toHaveAttribute("aria-pressed", "false");
    expect(mediumBtn).toHaveAttribute("aria-pressed", "true");
    expect(queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY)?.speed).toBe(1.15);
  });

  it("rolls back applyEngine cache & select when POST /api/commands returns 500", async () => {
    let configReads = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        if (configReads === 1) {
          return HttpResponse.json({ ...defaultTtsConfig, heavy_available: true, engine: "ligero" });
        }
        return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
      }),
      http.post(`${API_BASE_URL}/api/commands`, () => HttpResponse.json({ detail: "server error" }, { status: 500 }))
    );

    const { queryClient } = renderCard();
    const select = await screen.findByRole("combobox", { name: "Motor TTS" });
    await waitFor(() => expect(select).toHaveTextContent("Ligero (Edge-TTS)"));

    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "Pesado (Heavy)" }));
    expect(select).toHaveTextContent("Pesado (Heavy)");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/500/));
    expect(select).toHaveTextContent("Ligero (Edge-TTS)");
    expect(select).not.toBeDisabled();
    expect(queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY)?.engine).toBe("ligero");
  });

  it("rolls back applyDiscardResidue cache & switch on network error", async () => {
    let configReads = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        if (configReads === 1) {
          return HttpResponse.json({ ...defaultTtsConfig, discard_speech_residue: false });
        }
        return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
      }),
      commandNetworkErrorHandler()
    );

    const { queryClient } = renderCard();
    const toggle = await screen.findByRole("switch", { name: "Descartar residuos al interrumpir" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).not.toBeDisabled();
    expect(queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY)?.discard_speech_residue).toBe(false);
  });

  it("rolls back applyVoice when POST /api/commands stalls and hits the bounded timeout", async () => {
    vi.useFakeTimers();
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json({ ...defaultTtsConfig, piper_voice: "english" })
      ),
      http.post(`${API_BASE_URL}/api/commands`, () => new Promise(() => {}))
    );

    const { queryClient } = renderCard();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    const select = screen.getByRole("combobox", { name: "Idioma" });
    expect(select).toHaveTextContent("🇺🇸 English");

    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "🌎 Neutral" }));
    expect(select).toHaveTextContent("🌎 Neutral");
    expect(select).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(15000));

    expect(select).not.toBeDisabled();
    expect(select).toHaveTextContent("🇺🇸 English");
    expect(queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY)?.piper_voice).toBe("english");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("rolls back applyEngine immediately when a post-accept failure event arrives", async () => {
    let configReads = 0;
    server.use(
      frozenStatusHandler(1),
      http.get(`${API_BASE_URL}/api/tts/config`, () => {
        configReads += 1;
        if (configReads === 1) {
          return HttpResponse.json({
            ...defaultTtsConfig,
            heavy_available: true,
            engine: "ligero"
          });
        }
        return HttpResponse.json({ detail: "unavailable" }, { status: 500 });
      }),
      defaultCommandHandler()
    );

    const { queryClient } = renderCard();
    const select = await screen.findByRole("combobox", { name: "Motor TTS" });
    await waitFor(() => expect(select).toHaveTextContent("Ligero (Edge-TTS)"));

    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "Pesado (Heavy)" }));
    expect(select).toHaveTextContent("Pesado (Heavy)");
    await waitFor(() => expect(select).toBeDisabled());

    act(() => {
      useEventStore.getState().append({
        id: "evt-tts-fail",
        ts: Date.now(),
        source: "motor",
        action: "model_switch_failed",
        label: "Fallo al cambiar motor",
        tone: "danger"
      });
    });

    await waitFor(() => expect(select).not.toBeDisabled());
    expect(select).toHaveTextContent("Ligero (Edge-TTS)");
    expect(queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY)?.engine).toBe("ligero");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("rolls back only the failed field without clobbering an accepted concurrent sibling setting", async () => {
    let currentSpeed = 1.15;
    server.use(
      frozenStatusHandler(1),
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json({
          ...defaultTtsConfig,
          piper_voice: "english",
          speed: currentSpeed
        })
      ),
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        const body = (await request.json()) as { command: string; payload?: { value?: unknown } };
        if (body.command === "set_tts_speed") {
          currentSpeed = Number(body.payload?.value ?? 1.45);
          return HttpResponse.json({ accepted: true, command_id: "cmd-speed-ok", status: "queued", state_version: 1 });
        }
        return HttpResponse.json({ detail: "voice conflict" }, { status: 409 });
      })
    );

    const { queryClient } = renderCard();
    const select = await screen.findByRole("combobox", { name: "Idioma" });
    await waitFor(() => expect(select).toHaveTextContent("🇺🇸 English"));

    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "🌎 Neutral" }));
    fireEvent.click(screen.getByRole("button", { name: "Lenta" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());

    expect(select).toHaveTextContent("🇺🇸 English");
    expect(screen.getByRole("button", { name: "Lenta" })).toHaveAttribute("aria-pressed", "true");
    expect(queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY)?.piper_voice).toBe("english");
    expect(queryClient.getQueryData<TtsConfig>(TTS_CONFIG_QUERY_KEY)?.speed).toBe(1.45);
  });
});

describe("VoiceCard per-control spinner & applying status (S3)", () => {
  it("shows a spinner in the pending badge, comboboxes, segmented speed pill, and local-only status while applying", async () => {
    server.use(frozenStatusHandler(1));
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json({ ...defaultTtsConfig, heavy_available: true, local_only: true })
      ),
      defaultCommandHandler()
    );
    renderCard();

    const voiceSelect = await screen.findByRole("combobox", { name: "Idioma" });
    fireEvent.click(voiceSelect);
    fireEvent.click(screen.getByRole("option", { name: "🇺🇸 English" }));

    expect(voiceSelect).toHaveAttribute("aria-busy", "true");
    expect(voiceSelect.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByText("Guardando idioma…")).toBeInTheDocument();
    const pendingBadge = screen.getByText("aplicando…").closest("span");
    expect(pendingBadge?.querySelector("svg.animate-spin")).not.toBeNull();

    const slowBtn = screen.getByRole("button", { name: "Lenta" });
    fireEvent.click(slowBtn);
    expect(slowBtn).toHaveAttribute("aria-pressed", "true");
    expect(slowBtn).toHaveAttribute("aria-busy", "true");
    expect(slowBtn.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByText("Guardando velocidad…")).toBeInTheDocument();

    const engineSelect = screen.getByRole("combobox", { name: "Motor TTS" });
    fireEvent.click(engineSelect);
    fireEvent.click(screen.getByRole("option", { name: "Pesado (Heavy)" }));
    expect(engineSelect).toHaveAttribute("aria-busy", "true");
    expect(engineSelect.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByText("Guardando motor TTS…")).toBeInTheDocument();

    const localSwitch = screen.getByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(localSwitch);
    const localStatus = screen.getByText("Guardando el modo de TTS local…").closest("p");
    expect(localStatus?.querySelector("svg.animate-spin")).not.toBeNull();

    await waitFor(() => expect(voiceSelect).not.toBeDisabled());
    await waitFor(() => expect(engineSelect).not.toBeDisabled());
  });

  it("shows an honest apply-failed alert when a voice engine command fails post-accept", async () => {
    server.use(
      frozenStatusHandler(1),
      http.get(`${API_BASE_URL}/api/tts/config`, () =>
        HttpResponse.json({ ...defaultTtsConfig, heavy_available: true, engine: "ligero" })
      ),
      defaultCommandHandler()
    );
    renderCard();
    const select = await screen.findByRole("combobox", { name: "Motor TTS" });
    await waitFor(() => expect(select).toHaveTextContent("Ligero (Edge-TTS)"));
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "Pesado (Heavy)" }));
    await waitFor(() => expect(select).toBeDisabled());

    act(() => {
      useEventStore.getState().append({
        id: "evt-tts-fail-copy",
        ts: Date.now(),
        source: "motor",
        action: "model_switch_failed",
        label: "Fallo",
        tone: "danger"
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("El motor no pudo aplicar el cambio de voz.")
    );
  });
});
