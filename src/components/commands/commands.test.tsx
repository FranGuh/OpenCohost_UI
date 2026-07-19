import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerCommandPanel } from "../ComposerCommandPanel.js";
import { Stepper } from "./Stepper.js";
import type { Command } from "./registry.js";
import type { StepValue } from "./primitives.js";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  agendaGetErrorHandler,
  agendaGetHandler,
  defaultAgenda,
  defaultStreamChatLive
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

  it("/perfil renders the Identidad and Sesión sections", () => {
    renderPanel("/perfil");
    enterCommand(/perfil — creá o ajustá/);

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

  it("/sesion emergency button is inert (only a maquetado acknowledgement)", () => {
    renderPanel("/sesion");
    enterCommand(/sesion — controlá la sesión/);

    const emergency = screen.getByRole("button", { name: "Parada de emergencia" });
    expect(screen.queryByText("maquetado — sin efecto todavía")).not.toBeInTheDocument();

    fireEvent.click(emergency);
    expect(screen.getByText("maquetado — sin efecto todavía")).toBeInTheDocument();
  });

  it("/musica goes straight to the summary for a transport action (no song step)", () => {
    renderPanel("/musica");
    enterCommand(/musica — controlá la música/);

    // Default action is Reproducir → a single visible step, so "Revisar" leads
    // straight to the summary and the conditional song step never appears.
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(screen.queryByText("¿Qué canción?")).not.toBeInTheDocument();

    const primary = screen.getByRole("button", { name: "Aplicar" });
    expect(primary).toBeDisabled();
  });

  it("/musica reveals the song step only for 'Poner una canción' and keeps the action disabled", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderPanel("/musica");
    enterCommand(/musica — controlá la música/);

    // The song step is gated until the action is switched to "Poner una canción".
    expect(screen.queryByText("¿Qué canción?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "¿Qué querés hacer?" }));
    fireEvent.click(screen.getByRole("option", { name: "Poner una canción" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    const song = screen.getByLabelText("¿Qué canción?") as HTMLInputElement;
    fireEvent.change(song, { target: { value: "Gorillaz — Feel Good Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));

    const primary = screen.getByRole("button", { name: "Poner canción" });
    expect(primary).toBeDisabled();
    // The song collapses to a chip (top row + SummaryCard both render it).
    expect(screen.getAllByText("Gorillaz — Feel Good Inc").length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("makes NO network call while driving commands and screens", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // A stepper command…
    const { unmount } = renderPanel("/agenda");
    enterCommand(/agenda — programá un tema/);
    fireEvent.change(screen.getByLabelText("¿Qué tema querés agendar?"), { target: { value: "mods retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    unmount();

    // …and an action screen. (Fresh mount — activeId is internal panel state.)
    renderPanel("/sesion");
    enterCommand(/sesion — controlá la sesión/);
    fireEvent.click(screen.getByRole("button", { name: "Activar" }));

    expect(fetchSpy).not.toHaveBeenCalled();
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
    renderPanel("/perfil");
    enterCommand(/perfil — creá o ajustá/);
    fireEvent.change(screen.getByLabelText("¿Cómo se llama el perfil?"), { target: { value: "Kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → estilo
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → turnos
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → modo
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → ritmo
    fireEvent.click(screen.getByRole("button", { name: "Revisar" })); // → summary

    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    expect(screen.getByText("Guarda el nombre y el estilo como un perfil reutilizable.")).toBeInTheDocument();
  });
});
