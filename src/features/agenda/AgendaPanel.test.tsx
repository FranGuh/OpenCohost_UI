import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  agendaGetErrorHandler,
  agendaGetHandler,
  agendaSessionActionCaptureHandler,
  agendaSessionActionEmptyQueueHandler,
  agendaSessionActionErrorHandler,
  agendaSessionCaptureHandler,
  agendaTopicActionCaptureHandler,
  agendaTopicActionErrorHandler,
  agendaTopicValidationHandler,
  cohostProfileSaveCaptureHandler,
  cohostProfileSaveValidationHandler,
  cohostProfileSelectCaptureHandler,
  cohostProfileSelectNotFoundHandler,
  defaultAgenda,
  defaultCohostProfiles
} from "../../test/handlers.js";
import { AgendaPanel } from "./AgendaPanel.js";
import { ToastProvider } from "../../ui/Toast.js";

beforeEach(() => {
  window.localStorage.clear();
});

// AgendaPanel now splits into two panes (PaneSwitcher): "Perfil co-host"
// (default — ProfileSessionCard, including the Sesión group most tests below
// use as their post-GET readiness signal) and "Temas" (Ahora/Cola/Agregar
// tema/Sugerencias). SessionControlCard is not a pane — it renders in both,
// so session-action tests need no pane switch at all.
function goToTopics() {
  fireEvent.click(screen.getByRole("button", { name: "Temas" }));
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ToastProvider, null, React.createElement(AgendaPanel))
    )
  );
}

function selectCustomOption(comboboxName: string | RegExp, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("AgendaPanel hydrates Now/Queue from GET /api/agenda", () => {
  it("shows the active topic from GET, highlighted as live", async () => {
    renderPanel();
    goToTopics();
    const now = screen.getByTestId("agenda-now");
    await waitFor(() => expect(within(now).getByText("Mods como cultura popular en gaming")).toBeInTheDocument());
    expect(within(now).getByText("en vivo")).toBeInTheDocument();
  });

  it("lists queued topics from GET in order with a priority badge each", async () => {
    renderPanel();
    goToTopics();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^tema en cola/i })).toHaveLength(2));
    const items = screen.getAllByRole("listitem", { name: /^tema en cola/i });
    expect(within(items[0]).getByText("La nostalgia noventera en internet")).toBeInTheDocument();
    expect(within(items[1]).getByText("Streamers y burnout")).toBeInTheDocument();
  });

  it("hydrates session settings (turnos/ritmo/modo) from GET", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Intentos por tema" })).toHaveTextContent("3"));
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Modo de seguridad en vivo" })).toHaveTextContent("Live-safe");
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded agenda", async () => {
    server.use(agendaGetErrorHandler());
    renderPanel();
    // No pane switch — the load-error alert is pane-independent (JD-1) and
    // must be visible on the default Perfil co-host pane, not just Temas.
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("agenda-now")).not.toBeInTheDocument();
  });

  it("shows an empty-queue message when GET returns no queued topics", async () => {
    server.use(agendaGetHandler({ ...defaultAgenda, queued_topics: [] }));
    renderPanel();
    goToTopics();
    await waitFor(() => expect(screen.getByText("No hay temas en cola todavía.")).toBeInTheDocument());
  });
});

describe("AgendaPanel queue actions fire POST /api/agenda/topic/action", () => {
  it("moving a topic up sends action=move with a negative direction and the topic id", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaTopicActionCaptureHandler(capture));
    renderPanel();
    goToTopics();

    await screen.findByText("Streamers y burnout");
    fireEvent.click(screen.getByRole("button", { name: /Subir "Streamers y burnout"/ }));

    await waitFor(() =>
      expect(capture.body).toEqual({ action: "move", topic_id: "topic-2", direction: -1 })
    );
  });

  it("removing a topic sends action=remove with the topic id", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaTopicActionCaptureHandler(capture));
    renderPanel();
    goToTopics();

    await screen.findByText("Streamers y burnout");
    fireEvent.click(screen.getByRole("button", { name: /Quitar "Streamers y burnout"/ }));

    await waitFor(() => expect(capture.body).toEqual({ action: "remove", topic_id: "topic-2" }));
  });
});

describe("AgendaPanel add-topic form fires POST /api/agenda/topic", () => {
  it("rejects an empty title client-side without hitting the network", async () => {
    renderPanel();
    await screen.findByLabelText("Intentos por tema");
    goToTopics();
    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El título no puede estar vacío.");
  });

  it("adds a valid topic and it appears in the hydrated queue", async () => {
    renderPanel();
    await screen.findByLabelText("Intentos por tema");
    goToTopics();

    fireEvent.change(screen.getByLabelText("Título del tema"), { target: { value: "Un tema nuevo" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));

    await waitFor(() => expect(screen.getByText("Un tema nuevo")).toBeInTheDocument());
    expect(screen.getByLabelText("Título del tema")).toHaveValue("");
  });

  it("surfaces a 422 validation error from the backend", async () => {
    server.use(agendaTopicValidationHandler("El título parece código"));
    renderPanel();
    await screen.findByLabelText("Intentos por tema");
    goToTopics();

    fireEvent.change(screen.getByLabelText("Título del tema"), { target: { value: "function() {}" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("El título parece código"));
  });
});

describe("AgendaPanel session settings fire PUT /api/agenda/session", () => {
  it("changing turnos sends only max_turns_per_topic", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionCaptureHandler(capture));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Intentos por tema" })).toHaveTextContent("3"));

    selectCustomOption("Intentos por tema", "5");

    await waitFor(() => expect(capture.body).toEqual({ max_turns_per_topic: 5 }));
  });

  it("changing ritmo sends only rhythm", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionCaptureHandler(capture));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Intentos por tema" })).toHaveTextContent("3"));

    fireEvent.click(screen.getByRole("button", { name: "Dinámico" }));

    await waitFor(() => expect(capture.body).toEqual({ rhythm: "dinamico" }));
  });

  it("changing modo de seguridad sends only safety_mode", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionCaptureHandler(capture));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Intentos por tema" })).toHaveTextContent("3"));

    selectCustomOption("Modo de seguridad en vivo", "Monólogo");

    await waitFor(() => expect(capture.body).toEqual({ safety_mode: "monologue" }));
  });
});

describe("AgendaPanel session badge reflects live data, not the mock fixture", () => {
  it("derives the badge from live data.state instead of AGENDA_FIXTURE.session_state", async () => {
    server.use(
      agendaGetHandler({
        ...defaultAgenda,
        state: "PAUSED_NEEDS_OPERATOR",
        metrics: { ...defaultAgenda.metrics, current_state: "PAUSED_NEEDS_OPERATOR" }
      })
    );
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });

    expect(screen.getByText("pausa suave")).toBeInTheDocument();
    expect(screen.queryByText("activa")).not.toBeInTheDocument();
  });
});

describe("AgendaPanel suggestions hydrate from GET /api/agenda's drafted_topics", () => {
  it("lists drafted topics as suggestions with a confidence badge each", async () => {
    renderPanel();
    goToTopics();
    await waitFor(() =>
      expect(screen.getByText("IA generativa en overlays de stream")).toBeInTheDocument()
    );
    expect(screen.getByText("Por qué el chat repite memes viejos")).toBeInTheDocument();
    const suggestionList = screen.getByRole("list", { name: "Sugerencias de Kira" });
    expect(within(suggestionList).getByText("confianza alta")).toBeInTheDocument();
    expect(within(suggestionList).getByText("confianza media")).toBeInTheDocument();
  });

  it("shows an empty-suggestions message when GET returns no drafted topics", async () => {
    server.use(agendaGetHandler({ ...defaultAgenda, drafted_topics: [] }));
    renderPanel();
    goToTopics();
    await waitFor(() => expect(screen.getByText("Sin sugerencias pendientes.")).toBeInTheDocument());
  });
});

describe("AgendaPanel suggestion actions fire POST /api/agenda/topic/action", () => {
  it("approving a suggestion sends action=approve with the drafted topic's id", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaTopicActionCaptureHandler(capture));
    renderPanel();
    goToTopics();

    await screen.findByText("IA generativa en overlays de stream");
    fireEvent.click(screen.getByRole("button", { name: /Aprobar "IA generativa en overlays de stream"/ }));

    await waitFor(() => expect(capture.body).toEqual({ action: "approve", topic_id: "topic-draft-1" }));
  });

  it("rejecting a suggestion sends action=reject with the drafted topic's id", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaTopicActionCaptureHandler(capture));
    renderPanel();
    goToTopics();

    await screen.findByText("Por qué el chat repite memes viejos");
    fireEvent.click(screen.getByRole("button", { name: /Rechazar "Por qué el chat repite memes viejos"/ }));

    await waitFor(() => expect(capture.body).toEqual({ action: "reject", topic_id: "topic-draft-2" }));
  });

  it("surfaces an error when a suggestion action is rejected by the backend", async () => {
    server.use(agendaTopicActionErrorHandler());
    renderPanel();
    goToTopics();

    await screen.findByText("IA generativa en overlays de stream");
    fireEvent.click(screen.getByRole("button", { name: /Aprobar "IA generativa en overlays de stream"/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo aplicar la acción sobre la sugerencia.")
    );
  });
});

describe("AgendaPanel co-host profile hydrates from GET /api/agenda/cohost-profiles", () => {
  it("hydrates the saved-profiles select and style textarea from GET", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByLabelText("Estilo del perfil co-host")).toHaveValue(defaultCohostProfiles.profiles[0].style)
    );
    expect(screen.getByRole("combobox", { name: "Perfiles guardados" })).toHaveTextContent("Natural");
  });

  it("selecting a saved profile fires POST /api/agenda/cohost-profiles/select with its name", async () => {
    const capture: { body?: unknown } = {};
    server.use(cohostProfileSelectCaptureHandler(capture, { selected: "Filosa" }));
    renderPanel();
    await waitFor(() =>
      expect(screen.getByLabelText("Estilo del perfil co-host")).toHaveValue(defaultCohostProfiles.profiles[0].style)
    );

    selectCustomOption("Perfiles guardados", "Filosa");

    await waitFor(() => expect(capture.body).toEqual({ name: "Filosa" }));
    expect(screen.getByLabelText("Estilo del perfil co-host")).toHaveValue(defaultCohostProfiles.profiles[1].style);
  });

  it("surfaces an error when selecting a profile fails", async () => {
    server.use(cohostProfileSelectNotFoundHandler("profile not found"));
    renderPanel();
    await waitFor(() =>
      expect(screen.getByLabelText("Estilo del perfil co-host")).toHaveValue(defaultCohostProfiles.profiles[0].style)
    );

    selectCustomOption("Perfiles guardados", "Filosa");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("profile not found"));
  });
});

describe("AgendaPanel co-host profile save fires POST /api/agenda/cohost-profiles", () => {
  it("saving sends the edited name and current style text", async () => {
    const capture: { body?: unknown } = {};
    server.use(cohostProfileSaveCaptureHandler(capture));
    renderPanel();
    await waitFor(() =>
      expect(screen.getByLabelText("Estilo del perfil co-host")).toHaveValue(defaultCohostProfiles.profiles[0].style)
    );

    fireEvent.change(screen.getByLabelText("Nombre del perfil co-host"), { target: { value: "Natural remix" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));

    await waitFor(() =>
      expect(capture.body).toEqual({ name: "Natural remix", style: defaultCohostProfiles.profiles[0].style })
    );
  });

  it("surfaces a 422 validation error (empty profile name)", async () => {
    server.use(cohostProfileSaveValidationHandler("empty profile name"));
    renderPanel();
    await waitFor(() =>
      expect(screen.getByLabelText("Estilo del perfil co-host")).toHaveValue(defaultCohostProfiles.profiles[0].style)
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("empty profile name"));
  });
});

describe("AgendaPanel Perfil Co-host form regroups Sesión → Identidad → Estilo → Guardar perfil (owner order 2026-07-15)", () => {
  it("renders visible field labels and section headers in visual/document order, leading with the session group", async () => {
    renderPanel();
    await screen.findByLabelText("Intentos por tema");

    const sesion = screen.getByText("Sesión");
    const instantChip = screen.getByText("se aplica al instante");
    const identidad = screen.getByText("Identidad");
    const perfilGuardado = screen.getByText("Perfil guardado");
    const nombre = screen.getByText("Nombre");
    const estilo = screen.getByText("Estilo");
    const comoSuenaKira = screen.getByText("Cómo suena Kira");
    const saveButton = screen.getByRole("button", { name: "Guardar perfil" });
    const helper = screen.getByText("Guarda el nombre y el estilo como un perfil reutilizable.");

    const ordered = [sesion, instantChip, identidad, perfilGuardado, nombre, estilo, comoSuenaKira, helper, saveButton];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(
        ordered[i].compareDocumentPosition(ordered[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it("keeps the save button (tab order = visual order) after the style textarea, not between name and style", async () => {
    renderPanel();
    await screen.findByLabelText("Intentos por tema");

    const nameInput = screen.getByLabelText("Nombre del perfil co-host");
    const textarea = screen.getByLabelText("Estilo del perfil co-host");
    const saveButton = screen.getByRole("button", { name: "Guardar perfil" });

    expect(nameInput.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(textarea.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows Guardando… on the save button while the save request is in flight", async () => {
    let resolveRequest!: () => void;
    server.use(
      http.post(
        `${API_BASE_URL}/api/agenda/cohost-profiles`,
        () =>
          new Promise((resolve) => {
            resolveRequest = () => resolve(HttpResponse.json(defaultCohostProfiles));
          })
      )
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.getByLabelText("Estilo del perfil co-host")).toHaveValue(defaultCohostProfiles.profiles[0].style)
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled());
    resolveRequest();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar perfil" })).not.toBeDisabled());
  });
});

describe("AgendaPanel session control fires POST /api/agenda/session/action", () => {
  it("clicking Activar sends action=enable", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionActionCaptureHandler(capture));
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });

    fireEvent.click(screen.getByRole("button", { name: "Activar" }));

    await waitFor(() => expect(capture.body).toEqual({ action: "enable" }));
  });

  it("clicking Pausa suave sends action=soft_stop", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionActionCaptureHandler(capture));
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });

    fireEvent.click(screen.getByRole("button", { name: "Pausa suave" }));

    await waitFor(() => expect(capture.body).toEqual({ action: "soft_stop" }));
  });

  it("clicking Emergencia sends action=emergency_stop", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionActionCaptureHandler(capture));
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });

    fireEvent.click(screen.getByRole("button", { name: "Emergencia" }));

    await waitFor(() => expect(capture.body).toEqual({ action: "emergency_stop" }));
  });

  it("disables all three session-action buttons while one is pending", async () => {
    let resolveRequest!: () => void;
    server.use(
      http.post(
        `${API_BASE_URL}/api/agenda/session/action`,
        () =>
          new Promise((resolve) => {
            resolveRequest = () => resolve(HttpResponse.json(defaultAgenda));
          })
      )
    );
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });

    fireEvent.click(screen.getByRole("button", { name: "Activar" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Activar" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Pausa suave" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Emergencia" })).toBeDisabled();

    resolveRequest();
    await waitFor(() => expect(screen.getByRole("button", { name: "Activar" })).not.toBeDisabled());
  });

  it("surfaces an error when a session action is rejected", async () => {
    server.use(agendaSessionActionErrorHandler());
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });

    fireEvent.click(screen.getByRole("button", { name: "Activar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo aplicar la acción de sesión.")
    );
  });

  it("surfaces the CTK-parity empty-queue outcome when enable is refused", async () => {
    // The live queue must actually be empty for the alert to fire (F4 gating).
    server.use(agendaGetHandler({ ...defaultAgenda, queued_topics: [] }));
    server.use(agendaSessionActionEmptyQueueHandler());
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });

    fireEvent.click(screen.getByRole("button", { name: "Activar" }));

    await waitFor(() =>
      expect(
        screen.getByText("No hay temas en cola — agregá o aprobá un tema primero.")
      ).toBeInTheDocument()
    );
    // A 200 empty-queue outcome is NOT an error path.
    expect(screen.queryByText("No se pudo aplicar la acción de sesión.")).not.toBeInTheDocument();
  });

  it("clears the empty-queue alert once a topic is added to the live queue (F4)", async () => {
    server.use(agendaGetHandler({ ...defaultAgenda, queued_topics: [] }));
    server.use(agendaSessionActionEmptyQueueHandler());
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });

    // Enable is refused because the queue is empty — the alert appears.
    fireEvent.click(screen.getByRole("button", { name: "Activar" }));
    await waitFor(() =>
      expect(
        screen.getByText("No hay temas en cola — agregá o aprobá un tema primero.")
      ).toBeInTheDocument()
    );

    // The operator adds a topic; the POST returns a full AgendaResponse with a
    // non-empty queue, which useAddAgendaTopicMutation writes into the agenda
    // cache. The alert must clear now that the live queue is non-empty.
    // AddTopicCard lives in the Temas pane — SessionControlCard (asserted
    // above/below) stays mounted through the switch, it's not a pane.
    goToTopics();
    fireEvent.change(screen.getByLabelText("Título del tema"), { target: { value: "Un tema nuevo" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));

    await waitFor(() =>
      expect(
        screen.queryByText("No hay temas en cola — agregá o aprobá un tema primero.")
      ).not.toBeInTheDocument()
    );
  });
});

describe("AgendaPanel add-topic extra fields, bulk, and templates (WU3)", () => {
  // POST /api/agenda/topic body-capture: pushes every request body so a test
  // can assert both the extra fields and the one-POST-per-bulk-line loop.
  function topicCaptureHandler(capture: { bodies: unknown[] }) {
    return http.post(`${API_BASE_URL}/api/agenda/topic`, async ({ request }) => {
      capture.bodies.push(await request.json());
      return HttpResponse.json(defaultAgenda);
    });
  }

  it("includes priority, response_length, and constraints in the POST body", async () => {
    const capture: { bodies: unknown[] } = { bodies: [] };
    server.use(topicCaptureHandler(capture));
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });
    goToTopics();

    fireEvent.change(screen.getByLabelText("Título del tema"), { target: { value: "Un tema nuevo" } });
    fireEvent.change(screen.getByLabelText("Ángulo (opcional)"), { target: { value: "Un ángulo" } });
    selectCustomOption("Prioridad", "Alta");
    selectCustomOption("Largo de respuesta", "Expandida");

    const tagInput = screen.getByLabelText("Etiquetas (constraints)");
    fireEvent.change(tagInput, { target: { value: "sin spoilers" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));

    await waitFor(() => expect(capture.bodies).toHaveLength(1));
    expect(capture.bodies[0]).toEqual({
      title: "Un tema nuevo",
      angle: "Un ángulo",
      priority: "alta",
      response_length: "expandida",
      constraints: ["sin spoilers"]
    });
  });

  it("parses the bulk textarea into one POST per non-blank line", async () => {
    const capture: { bodies: unknown[] } = { bodies: [] };
    server.use(topicCaptureHandler(capture));
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });
    goToTopics();

    fireEvent.change(screen.getByLabelText("Temas en lote"), {
      target: {
        value:
          "Tema uno | ángulo uno | alta | tag1, tag2\n" +
          "\n" +
          "Tema dos | ángulo dos | baja | tag3\n" +
          "Tema tres"
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar en lote" }));

    await waitFor(() => expect(capture.bodies).toHaveLength(3));
    expect(capture.bodies[0]).toEqual({
      title: "Tema uno",
      angle: "ángulo uno",
      priority: "alta",
      response_length: "normal",
      constraints: ["tag1", "tag2"]
    });
    expect(capture.bodies[1]).toEqual({
      title: "Tema dos",
      angle: "ángulo dos",
      priority: "baja",
      response_length: "normal",
      constraints: ["tag3"]
    });
    expect(capture.bodies[2]).toEqual({
      title: "Tema tres",
      angle: "",
      priority: "normal",
      response_length: "normal",
      constraints: []
    });
  });

  it("prefills the form when a template is clicked", async () => {
    renderPanel();
    await screen.findByRole("combobox", { name: "Intentos por tema" });
    goToTopics();

    fireEvent.click(screen.getByRole("button", { name: /Nostalgia de los 2000 en gaming/ }));

    expect(screen.getByLabelText("Título del tema")).toHaveValue("Nostalgia de los 2000 en gaming");
    expect(screen.getByRole("combobox", { name: "Prioridad" })).toHaveTextContent("Normal");
  });
});

describe("AgendaPanel pane switcher (Perfil co-host / Temas)", () => {
  it("defaults to Perfil co-host — its pane is visible, Temas is hidden (both stay mounted)", async () => {
    renderPanel();
    await screen.findByLabelText("Intentos por tema");

    expect(screen.getByLabelText("Estilo del perfil co-host")).toBeInTheDocument();
    expect(screen.getByTestId("agenda-pane-profile")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("agenda-pane-topics")).toHaveAttribute("hidden");

    // Mounted, not absent — Temas content is a real DOM node behind `hidden`.
    expect(screen.getByTestId("agenda-now")).toBeInTheDocument();
  });

  it("switching to Temas flips which pane is hidden, without unmounting Perfil co-host", async () => {
    renderPanel();
    await screen.findByLabelText("Intentos por tema");

    goToTopics();

    expect(screen.getByTestId("agenda-pane-topics")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("agenda-pane-profile")).toHaveAttribute("hidden");
    expect(screen.getByTestId("agenda-now")).toBeInTheDocument();
    expect(screen.getByLabelText("Título del tema")).toBeInTheDocument();
    expect(screen.getByLabelText("Estilo del perfil co-host")).toBeInTheDocument();
  });

  it("keeps SessionControlCard mounted in both panes — it is not a pane", async () => {
    renderPanel();
    await screen.findByLabelText("Intentos por tema");
    expect(screen.getByRole("button", { name: "Activar" })).toBeInTheDocument();

    goToTopics();
    expect(screen.getByRole("button", { name: "Activar" })).toBeInTheDocument();
  });

  it("a typed AddTopicCard title draft survives a pane round trip (Temas → Perfil → Temas) — the regression this change guards", async () => {
    renderPanel();
    await screen.findByLabelText("Intentos por tema");

    goToTopics();
    fireEvent.change(screen.getByLabelText("Título del tema"), { target: { value: "Borrador sin guardar" } });
    expect(screen.getByLabelText("Título del tema")).toHaveValue("Borrador sin guardar");

    fireEvent.click(screen.getByRole("button", { name: "Perfil co-host" }));
    goToTopics();

    expect(screen.getByLabelText("Título del tema")).toHaveValue("Borrador sin guardar");
  });
});
