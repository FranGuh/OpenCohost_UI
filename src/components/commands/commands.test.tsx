import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerCommandPanel } from "../ComposerCommandPanel.js";
import { Stepper } from "./Stepper.js";
import type { Command } from "./registry.js";
import type { StepValue } from "./primitives.js";
import { PRIORITY_VOCAB } from "./wire.js";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  agendaGetErrorHandler,
  agendaGetHandler,
  agendaSessionActionCaptureHandler,
  agendaSessionActionEmptyQueueHandler,
  agendaSessionCaptureHandler,
  agendaTopicCaptureHandler,
  agendaTopicValidationHandler,
  cohostProfileSaveCaptureHandler,
  defaultAgenda,
  defaultMusicLibrary,
  defaultStreamChatLive,
  musicLibraryGetHandler,
  musicMoodHandler,
  streamConnectBusyHandler,
  streamConnectInvalidUrlHandler
} from "../../test/handlers.js";

/**
 * Framework-level tests for the command palette. Most render
 * ComposerCommandPanel directly (no ConversationPanel harness). Commands that
 * now hit the backend (e.g. /temas → GET /api/agenda) run under a
 * QueryClientProvider with MSW handlers; the still-mock commands stay inert.
 */

const noop = () => {};

function renderPanel(query: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ComposerCommandPanel query={query} onClose={noop} />
    </QueryClientProvider>
  );
}

/** Click a command's list entry to enter it. */
function enterCommand(labelPattern: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: labelPattern }));
}

/** Open a custom Select by its accessible name and click one of its options. */
function selectOption(comboboxName: string | RegExp, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

/**
 * Walk /acciones' four steps (reacciones → cooldown → spam → contrato) to the
 * summary. Pass option labels to pick non-default values; omit a field to
 * accept that step's default.
 */
function driveAccionesTo(choices?: { reacciones?: string; cooldown?: string; spam?: string; contrato?: string }) {
  if (choices?.reacciones) selectOption("Reaccionar si el chat supera", choices.reacciones);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  if (choices?.cooldown) selectOption("Esperar al menos entre reacciones", choices.cooldown);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  if (choices?.spam) selectOption("Límite de mensajes repetidos", choices.spam);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
  if (choices?.contrato) selectOption("Contrato de entrada", choices.contrato);
  fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("command palette — registry + primitives (mockup)", () => {
  it("lists all seven commands and filters live by prefix", () => {
    const { rerender } = renderPanel("/");
    for (const badge of ["/agenda", "/perfil", "/temas", "/vivo", "/acciones", "/sesion", "/musica"]) {
      expect(screen.getByText(badge)).toBeInTheDocument();
    }

    // "/ac" narrows to /acciones only.
    rerender(<ComposerCommandPanel query="/ac" onClose={noop} />);
    expect(screen.getByText("/acciones")).toBeInTheDocument();
    expect(screen.queryByText("/agenda")).not.toBeInTheDocument();

    // "/mu" narrows to /musica only.
    rerender(<ComposerCommandPanel query="/mu" onClose={noop} />);
    expect(screen.getByText("/musica")).toBeInTheDocument();
    expect(screen.queryByText("/agenda")).not.toBeInTheDocument();

    // An unknown command shows the empty note.
    rerender(<ComposerCommandPanel query="/zzz" onClose={noop} />);
    expect(screen.getByText("comando desconocido")).toBeInTheDocument();
  });

  it("/agenda caps the tema at 90 chars with a live counter", () => {
    renderPanel("/agenda");
    enterCommand(/agenda — programá un tema/);

    const tema = screen.getByLabelText("¿Qué tema querés agendar?") as HTMLInputElement;
    fireEvent.change(tema, { target: { value: "a".repeat(120) } });

    expect(tema.value).toHaveLength(90);
    expect(screen.getByText("90/90")).toBeInTheDocument();
  });

  it("/agenda prioridad options are derived from wire.ts's PRIORITY_VOCAB, not a second hardcoded list (F6)", () => {
    renderPanel("/agenda");
    enterCommand(/agenda — programá un tema/);
    fireEvent.change(screen.getByLabelText("¿Qué tema querés agendar?"), { target: { value: "tema x" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → angulo
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → prioridad

    fireEvent.click(screen.getByRole("combobox", { name: "¿Qué prioridad tiene?" }));
    expect(screen.getAllByRole("option")).toHaveLength(PRIORITY_VOCAB.length);
    for (const entry of PRIORITY_VOCAB) {
      expect(screen.getByRole("option", { name: entry.label })).toBeInTheDocument();
    }
  });

  it("/perfil renders the Identidad and Sesión sections", () => {
    renderPanel("/perfil");
    enterCommand(/perfil — guardá o cambiá el perfil de co-host/);

    // Step 0 (nombre) is under Identidad.
    expect(screen.getByText("Identidad")).toBeInTheDocument();
    expect(screen.queryByText("Sesión")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("¿Cómo se llama el perfil?"), { target: { value: "Kira dry" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → estilo (Identidad)
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → turnos (Sesión)

    expect(screen.getByText("Sesión")).toBeInTheDocument();
    expect(screen.getByText("se aplica al instante")).toBeInTheDocument();
  });

  it("/temas lists the live agenda queue from GET /api/agenda (WU1/R11)", async () => {
    renderPanel("/temas");
    enterCommand(/temas — mirá qué hay en agenda/);

    // Topics + priority badges come from the live defaultAgenda queue, not the
    // old SAMPLE_TEMAS mock.
    expect(await screen.findByText("La nostalgia noventera en internet")).toBeInTheDocument();
    expect(screen.getByText("Streamers y burnout")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Temas en agenda" })).toBeInTheDocument();
    expect(screen.getByText("Alta")).toBeInTheDocument();

    // Old mock content and the maquetado note are gone; it stays a read screen.
    expect(screen.queryByText("Nostalgia de los 2000 en gaming")).not.toBeInTheDocument();
    expect(screen.queryByText("maquetado — va a leer la agenda real")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Siguiente" })).not.toBeInTheDocument();
  });

  it("/temas shows an explicit empty state when the queue is empty (R11)", async () => {
    server.use(agendaGetHandler({ ...defaultAgenda, queued_topics: [] }));
    renderPanel("/temas");
    enterCommand(/temas — mirá qué hay en agenda/);

    expect(await screen.findByText(/no hay temas en la cola/i)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Temas en agenda" })).not.toBeInTheDocument();
  });

  it("/temas shows an explicit unavailable message on a 503 (R11)", async () => {
    server.use(agendaGetErrorHandler(503, "agenda_unavailable"));
    renderPanel("/temas");
    enterCommand(/temas — mirá qué hay en agenda/);

    expect(await screen.findByRole("alert")).toHaveTextContent(/no se pudo leer la agenda/i);
    expect(screen.queryByRole("list", { name: "Temas en agenda" })).not.toBeInTheDocument();
  });

  it("/acciones replaces the disabled switch with a filter_policy select (WU3/R25)", () => {
    renderPanel("/acciones");
    enterCommand(/acciones — configurá cómo reacciona Kira/);

    // Advance past the three select groups to the Contrato de entrada step.
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → cooldown
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → spam
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → contrato

    // The disabled boolean switch and its "falta decidir" note are gone.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/falta decidir qué preset/)).not.toBeInTheDocument();

    // A select exposing exactly the 3 backend presets replaces it.
    const contrato = screen.getByRole("combobox", { name: "Contrato de entrada" });
    fireEvent.click(contrato);
    expect(screen.getByRole("option", { name: "Equilibrado" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Relajado (Twitch)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Estricto" })).toBeInTheDocument();
  });

  it("/acciones submits the mapped PUT /api/stream/chat-live/limits body (R22-R25)", async () => {
    const capture: { body?: unknown } = {};
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capture.body = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, ...(capture.body as object) });
      })
    );
    renderPanel("/acciones");
    enterCommand(/acciones — configurá cómo reacciona Kira/);

    driveAccionesTo({ reacciones: "Alto — 5 msg/s", cooldown: "Bajo — 20 s", spam: "20 msgs/usuario en 30s", contrato: "Estricto" });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar acciones" }));

    await screen.findByText(/se va a usar la próxima vez/i);
    expect(capture.body).toEqual({
      threshold_per_second: 5,
      cooldown_seconds: 20,
      max_messages_per_user: 20,
      filter_policy: "strict"
    });
  });

  it("/acciones ack says applied-immediately when the chat-live link is connected (R26)", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, connected: true })
      )
    );
    renderPanel("/acciones");
    enterCommand(/acciones — configurá cómo reacciona Kira/);

    driveAccionesTo();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar acciones" }));

    expect(await screen.findByText(/se aplicó al chat en vivo conectado/i)).toBeInTheDocument();
  });

  it("/acciones ack says saved-as-defaults when not connected (R26)", async () => {
    // Default PUT handler echoes defaultStreamChatLive.connected === false.
    renderPanel("/acciones");
    enterCommand(/acciones — configurá cómo reacciona Kira/);

    driveAccionesTo();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar acciones" }));

    expect(await screen.findByText(/se va a usar la próxima vez que conectes/i)).toBeInTheDocument();
  });

  it("/acciones never calls connect or disconnect (R26b)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderPanel("/acciones");
    enterCommand(/acciones — configurá cómo reacciona Kira/);

    driveAccionesTo();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar acciones" }));
    await screen.findByText(/se va a usar la próxima vez/i);

    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/chat-live/limits"))).toBe(true);
    expect(urls.some((url) => url.includes("/chat-live/connect"))).toBe(false);
    expect(urls.some((url) => url.includes("/chat-live/disconnect"))).toBe(false);
  });

  it("Descartar at the summary returns to the command list", () => {
    renderPanel("/vivo");
    enterCommand(/vivo — conectá el chat en vivo/);

    // Walk the two steps to the summary.
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // plataforma → canal
    fireEvent.change(screen.getByLabelText("Canal o URL"), { target: { value: "twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" })); // → summary

    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    // Back to the list: the command entry is visible again, the summary is gone.
    expect(screen.getByRole("button", { name: /vivo — conectá el chat en vivo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
  });

});

// ─── WU2: ActionRow real submit pipe (R1/R2/R3) ──────────────────────────────

function oneStepCommand(submit?: (values: Record<string, StepValue>) => Promise<string>): Command {
  return {
    id: "wu2fixture",
    badge: "/wu2",
    title: "fixture",
    description: "fixture command",
    summaryTitle: "Listo para enviar",
    primaryLabel: "Enviar",
    submit,
    steps: [{ kind: "text", id: "campo", question: "¿Valor?", chipLabel: "campo", optional: true }]
  };
}

function renderStepperToSummary(command: Command) {
  render(<Stepper command={command} onDiscard={noop} onCancel={noop} />);
  fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
}

describe("ActionRow submit pipe (WU2 — R1/R2/R3)", () => {
  it("idle: the primary action is enabled at the summary with no maquetado note", () => {
    renderStepperToSummary(oneStepCommand(() => Promise.resolve("ok")));

    expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled();
    expect(screen.queryByText(/maquetado/i)).not.toBeInTheDocument();
  });

  it("pending: clicking the primary disables it while the request is in flight (R1)", async () => {
    let resolve!: (ack: string) => void;
    renderStepperToSummary(oneStepCommand(() => new Promise<string>((res) => (resolve = res))));

    const primary = screen.getByRole("button", { name: "Enviar" });
    fireEvent.click(primary);
    expect(primary).toBeDisabled();

    resolve("¡Enviado!");
    expect(await screen.findByText("¡Enviado!")).toBeInTheDocument();
  });

  it("settled: renders the ack string the submit fn resolved with (R3)", async () => {
    renderStepperToSummary(oneStepCommand(() => Promise.resolve("Tema agregado a la cola")));

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Tema agregado a la cola")).toBeInTheDocument();
  });

  it("rapid double-click calls the submit fn exactly once (F1/F7)", async () => {
    let calls = 0;
    let resolve!: (ack: string) => void;
    const submit = () => {
      calls += 1;
      return new Promise<string>((res) => (resolve = res));
    };
    renderStepperToSummary(oneStepCommand(submit));

    const primary = screen.getByRole("button", { name: "Enviar" });
    // Two synchronous clicks in the same tick, before React re-renders the
    // "pending" (disabled) state — the useRef guard must block the second
    // call even though `phase` state hasn't updated yet.
    fireEvent.click(primary);
    fireEvent.click(primary);
    expect(calls).toBe(1);

    resolve("¡Enviado!");
    expect(await screen.findByText("¡Enviado!")).toBeInTheDocument();
  });

  it("failure keeps entered values and re-enables the primary for a retry (R2)", async () => {
    let attempt = 0;
    const submit = () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("Reintento OK");
    };
    render(<Stepper command={oneStepCommand(submit)} onDiscard={noop} onCancel={noop} />);
    fireEvent.change(screen.getByLabelText("¿Valor?"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));

    const primary = screen.getByRole("button", { name: "Enviar" });
    fireEvent.click(primary);

    // Values (the chip) survive the failure and the primary re-enables (R2).
    await waitFor(() => expect(primary).toBeEnabled());
    expect(screen.getAllByText("hola").length).toBeGreaterThan(0);

    // A second attempt succeeds without re-walking the stepper.
    fireEvent.click(primary);
    expect(await screen.findByText("Reintento OK")).toBeInTheDocument();
  });

  it("regression: a command with no submit fn keeps today's disabled maquetado ActionRow", () => {
    // WU10 wired /perfil (all 7 commands now dispatch), so the inert-ActionRow
    // regression is guarded with a submit-less inline fixture instead.
    renderStepperToSummary(oneStepCommand());

    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    expect(screen.getByText("maquetado — todavía no envía")).toBeInTheDocument();
  });
});

// ─── WU7: /agenda → postAgendaTopic (R12-R15, R33-R35) ────────────────────────

/** Walk /agenda's steps (tema → angulo → prioridad → largo → etiquetas) to the
 * summary. Pass option LABELS for prioridad/largo; omit to accept defaults. */
function driveAgenda(input: { tema: string; prioridad?: string; largo?: string; etiquetas?: string[] }) {
  fireEvent.change(screen.getByLabelText("¿Qué tema querés agendar?"), { target: { value: input.tema } });
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → angulo (optional)
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → prioridad
  if (input.prioridad) selectOption("¿Qué prioridad tiene?", input.prioridad);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → largo
  if (input.largo) selectOption("¿Qué largo de respuesta?", input.largo);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → etiquetas
  for (const tag of input.etiquetas ?? []) {
    const tagInput = screen.getByLabelText("Etiquetas (opcional)");
    fireEvent.change(tagInput, { target: { value: tag } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
  }
  fireEvent.click(screen.getByRole("button", { name: "Revisar" })); // → summary
}

describe("/agenda → postAgendaTopic (WU7 — R12-R15, R33-R35)", () => {
  it("submits mapped priority/length wire values + constraints in entry order (R12/R13/R14)", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaTopicCaptureHandler(capture));
    renderPanel("/agenda");
    enterCommand(/agenda — programá un tema/);

    driveAgenda({ tema: "mods retro", prioridad: "Alta", largo: "Profundo", etiquetas: ["retro", "mods", "gaming"] });
    fireEvent.click(screen.getByRole("button", { name: "Programar tema" }));

    await screen.findByText(/tema agregado a la cola/i);
    // Wire values (not raw UI labels), etiquetas → constraints in entry order,
    // and no `angle` key when the optional step was left empty.
    expect(capture.body).toEqual({
      title: "mods retro",
      priority: "alta",
      response_length: "expandida",
      constraints: ["retro", "mods", "gaming"]
    });
  });

  it("rapid double-click hits the MSW handler exactly once (F1/F7)", async () => {
    let hits = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/agenda/topic`, () => {
        hits += 1;
        return HttpResponse.json(defaultAgenda);
      })
    );
    renderPanel("/agenda");
    enterCommand(/agenda — programá un tema/);

    driveAgenda({ tema: "mods retro" });
    const primary = screen.getByRole("button", { name: "Programar tema" });
    fireEvent.click(primary);
    fireEvent.click(primary);

    await screen.findByText(/tema agregado a la cola/i);
    expect(hits).toBe(1);
  });

  it("surfaces a localized 422 failure, never the raw backend detail (R15/F4)", async () => {
    server.use(agendaTopicValidationHandler("tema inválido"));
    renderPanel("/agenda");
    enterCommand(/agenda — programá un tema/);

    driveAgenda({ tema: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Programar tema" }));

    expect(await screen.findByText(/probá de nuevo/i)).toBeInTheDocument();
    expect(screen.queryByText(/tema inválido/i)).not.toBeInTheDocument();
  });
});

// ─── WU8: /vivo → postStreamConnect (R20/R21) ────────────────────────────────

/** Walk /vivo's two steps (plataforma → canal) to the summary. */
function driveVivo(plataforma: string, canal: string) {
  selectOption("¿Qué plataforma?", plataforma);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → canal
  fireEvent.change(screen.getByLabelText("Canal o URL"), { target: { value: canal } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar" })); // → summary
}

describe("/vivo → postStreamConnect (WU8 — R20/R21)", () => {
  it("composes ONE url (no separate platform field) and acks the connect result (R20/R21)", async () => {
    const capture: { body?: unknown } = {};
    server.use(
      http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, async ({ request }) => {
        capture.body = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, connected: true, platform: "twitch", source_id: "kira" });
      })
    );
    renderPanel("/vivo");
    enterCommand(/vivo — conectá el chat en vivo/);

    driveVivo("Twitch", "kira");
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(await screen.findByText(/conectado a twitch \(kira\)/i)).toBeInTheDocument();
    // Only { url } — plataforma is UI-only, never a separate wire field.
    expect(capture.body).toEqual({ url: "twitch.tv/kira" });
  });

  it("surfaces a localized invalid_url copy inline, never the raw code (R21/F4)", async () => {
    server.use(streamConnectInvalidUrlHandler());
    renderPanel("/vivo");
    enterCommand(/vivo — conectá el chat en vivo/);

    driveVivo("Twitch", "no es una url");
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(await screen.findByText(/no es válida/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid_url/i)).not.toBeInTheDocument();
  });

  it("surfaces a 409 busy conflict rather than a silent failure (R21)", async () => {
    server.use(streamConnectBusyHandler());
    renderPanel("/vivo");
    enterCommand(/vivo — conectá el chat en vivo/);

    driveVivo("Twitch", "kira");
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(await screen.findByText(/en curso/i)).toBeInTheDocument();
  });
});

// ─── WU9: /sesion → postAgendaSessionAction (R27/R28) ────────────────────────

async function openSesion() {
  renderPanel("/sesion");
  enterCommand(/sesion — controlá la sesión/);
}

describe("/sesion → postAgendaSessionAction (WU9 — R27/R28)", () => {
  it("running state shows one 'Pausar' control that dispatches soft_stop (R27)", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionActionCaptureHandler(capture)); // default agenda = OPEN_TOPIC (running)
    await openSesion();

    const pausar = await screen.findByRole("button", { name: "Pausar" });
    // Activar/Reanudar collapse into the single state-driven toggle — not shown here.
    expect(screen.queryByRole("button", { name: "Reanudar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar" })).not.toBeInTheDocument();

    fireEvent.click(pausar);
    await waitFor(() => expect(capture.body).toEqual({ action: "soft_stop" }));
  });

  it("OFF state with a non-empty queue reads 'Activar' and dispatches enable (R27)", async () => {
    const capture: { body?: unknown } = {};
    server.use(
      agendaGetHandler({ ...defaultAgenda, state: "OFF", active_topic: null }),
      agendaSessionActionCaptureHandler(capture)
    );
    await openSesion();

    const activar = await screen.findByRole("button", { name: "Activar" });
    expect(screen.queryByRole("button", { name: "Pausar" })).not.toBeInTheDocument();

    fireEvent.click(activar);
    await waitFor(() => expect(capture.body).toEqual({ action: "enable" }));
  });

  it("paused state reads 'Reanudar' and dispatches the same enable action (R27)", async () => {
    const capture: { body?: unknown } = {};
    server.use(
      agendaGetHandler({ ...defaultAgenda, state: "HARD_PAUSED" }),
      agendaSessionActionCaptureHandler(capture)
    );
    await openSesion();

    fireEvent.click(await screen.findByRole("button", { name: "Reanudar" }));
    await waitFor(() => expect(capture.body).toEqual({ action: "enable" }));
  });

  it("emergency stop always dispatches emergency_stop regardless of state (R27)", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionActionCaptureHandler(capture));
    await openSesion();

    fireEvent.click(await screen.findByRole("button", { name: "Parada de emergencia" }));
    await waitFor(() => expect(capture.body).toEqual({ action: "emergency_stop" }));
  });

  it("an empty-queue enable is reported honestly, never as success (R28)", async () => {
    server.use(
      agendaGetHandler({ ...defaultAgenda, state: "OFF", active_topic: null, queued_topics: [] }),
      agendaSessionActionEmptyQueueHandler()
    );
    await openSesion();

    fireEvent.click(await screen.findByRole("button", { name: "Activar" }));
    expect(await screen.findByText(/cola está vacía/i)).toBeInTheDocument();
  });

  it("a guardrails_missing enable is reported as a refusal, not success (R28)", async () => {
    server.use(
      agendaGetHandler({ ...defaultAgenda, state: "OFF", active_topic: null }),
      http.post(`${API_BASE_URL}/api/agenda/session/action`, () =>
        HttpResponse.json({ ...defaultAgenda, applied: false, reason: "guardrails_missing" })
      )
    );
    await openSesion();

    fireEvent.click(await screen.findByRole("button", { name: "Activar" }));
    expect(await screen.findByText(/salvaguardas/i)).toBeInTheDocument();
  });
});

// ─── WU10: /perfil → saveCohostProfile + putAgendaSession (R16-R19) ───────────

/** Walk /perfil's steps (nombre → estilo → turnos → modo → ritmo) to the
 * summary. Pass option LABELS; omit to accept defaults. */
function drivePerfil(input: { nombre: string; turnos?: string; modo?: string; ritmo?: string }) {
  fireEvent.change(screen.getByLabelText("¿Cómo se llama el perfil?"), { target: { value: input.nombre } });
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → estilo (optional)
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → turnos
  if (input.turnos) selectOption("Turnos por tema", input.turnos);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → modo
  if (input.modo) selectOption("Modo de seguridad en vivo", input.modo);
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → ritmo
  if (input.ritmo) fireEvent.click(screen.getByRole("button", { name: input.ritmo })); // segmented control
  fireEvent.click(screen.getByRole("button", { name: "Revisar" })); // → summary
}

describe("/perfil → saveCohostProfile + putAgendaSession (WU10 — R16-R19)", () => {
  it("saves the cohost profile AND puts the session, never touching the LLM persona (R16/R17)", async () => {
    const profileCapture: { body?: unknown } = {};
    const sessionCapture: { body?: unknown } = {};
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    server.use(cohostProfileSaveCaptureHandler(profileCapture), agendaSessionCaptureHandler(sessionCapture));
    renderPanel("/perfil");
    enterCommand(/perfil — guardá o cambiá el perfil de co-host/);

    drivePerfil({ nombre: "Kira dry", turnos: "8", ritmo: "Dinámico" });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil de co-host" }));

    await screen.findByText(/perfil de co-host guardado/i);
    expect(profileCapture.body).toEqual({ name: "Kira dry", style: "" });
    expect(sessionCapture.body).toEqual({ max_turns_per_topic: 8, safety_mode: "live_safe", rhythm: "dinamico" });

    // R16 negative: the LLM-persona endpoint (POST /api/perfiles) is never called.
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/perfiles"))).toBe(false);
  });

  it("maps modo 'Estándar' to safety_mode monologue, never the raw string (R19)", async () => {
    const sessionCapture: { body?: unknown } = {};
    server.use(agendaSessionCaptureHandler(sessionCapture)); // default POST cohost-profiles handles the save
    renderPanel("/perfil");
    enterCommand(/perfil — guardá o cambiá el perfil de co-host/);

    drivePerfil({ nombre: "Kira", modo: "Estándar" });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil de co-host" }));

    await waitFor(() => expect(sessionCapture.body).toBeDefined());
    const body = sessionCapture.body as { safety_mode: string };
    expect(body.safety_mode).toBe("monologue");
    expect(body.safety_mode).not.toBe("estandar");
  });

  it("names the cohost profile in its list + summary copy, not the LLM persona (R18)", () => {
    renderPanel("/perfil");
    // The list description names the co-host profile unambiguously.
    expect(screen.getByText(/perfil de co-host de Kira/i)).toBeInTheDocument();

    enterCommand(/perfil — guardá o cambiá el perfil de co-host/);
    drivePerfil({ nombre: "Kira" });
    // The summary heading names the co-host profile too.
    expect(screen.getByText(/perfil de co-host listo para guardar/i)).toBeInTheDocument();
  });
});

// ─── WU11: /musica screen → library moods + postMusicMood (R29-R31) ──────────

async function openMusica() {
  renderPanel("/musica");
  enterCommand(/musica — controlá la música/);
  return screen.findByRole("combobox", { name: "Mood de la música" });
}

describe("/musica → library moods + postMusicMood (WU11 — R29-R31)", () => {
  it("offers exactly the live library moods, not the full KNOWN_MOODS set (R30)", async () => {
    server.use(musicLibraryGetHandler({ ...defaultMusicLibrary, moods: ["normal", "hype", "calm"] }));
    const combobox = await openMusica();
    fireEvent.click(combobox);

    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "normal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "hype" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "calm" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "tension" })).not.toBeInTheDocument();
  });

  it("dispatches POST /api/music/mood with the selected mood (R30)", async () => {
    const capture: { body?: unknown } = {};
    server.use(
      musicLibraryGetHandler({ ...defaultMusicLibrary, moods: ["normal", "hype", "calm"] }),
      http.post(`${API_BASE_URL}/api/music/mood`, async ({ request }) => {
        capture.body = await request.json();
        return HttpResponse.json({ active_mood: "hype", tracks: [], suggested_track_id: null });
      })
    );
    const combobox = await openMusica();
    fireEvent.click(combobox);
    fireEvent.click(screen.getByRole("option", { name: "hype" }));

    await waitFor(() => expect(capture.body).toEqual({ mood: "hype" }));
  });

  it("acks a fallback selection honestly instead of claiming the mood is active (R30)", async () => {
    server.use(
      musicLibraryGetHandler({ ...defaultMusicLibrary, moods: ["normal", "hype", "calm"] }),
      musicMoodHandler({ active_mood: "hype", tracks: [], suggested_track_id: null, fallback: true })
    );
    const combobox = await openMusica();
    fireEvent.click(combobox);
    fireEvent.click(screen.getByRole("option", { name: "hype" }));

    expect(await screen.findByText(/pool normal\/general/i)).toBeInTheDocument();
  });

  it("keeps the transport controls inert — no network call, no false ack (R31)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await openMusica();

    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    const moodCalls = fetchSpy.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/api/music/mood"));
    expect(moodCalls).toHaveLength(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("has no free-text song step anywhere (R29)", async () => {
    await openMusica();
    expect(screen.queryByLabelText("¿Qué canción?")).not.toBeInTheDocument();
  });
});
