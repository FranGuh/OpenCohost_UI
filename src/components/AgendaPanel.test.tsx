import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  agendaGetErrorHandler,
  agendaGetHandler,
  agendaSessionCaptureHandler,
  agendaTopicActionCaptureHandler,
  agendaTopicValidationHandler,
  defaultAgenda,
  frozenStatusHandler
} from "../test/handlers.js";
import { AGENDA_FIXTURE } from "../api/mock/fixtures.js";
import { AgendaPanel } from "./AgendaPanel.js";

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(AgendaPanel)));
}

describe("AgendaPanel hydrates Now/Queue from GET /api/agenda", () => {
  it("shows the active topic from GET, highlighted as live", async () => {
    renderPanel();
    const now = screen.getByTestId("agenda-now");
    await waitFor(() => expect(within(now).getByText("Mods como cultura popular en gaming")).toBeInTheDocument());
    expect(within(now).getByText("en vivo")).toBeInTheDocument();
  });

  it("lists queued topics from GET in order with a priority badge each", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^tema en cola/i })).toHaveLength(2));
    const items = screen.getAllByRole("listitem", { name: /^tema en cola/i });
    expect(within(items[0]).getByText("La nostalgia noventera en internet")).toBeInTheDocument();
    expect(within(items[1]).getByText("Streamers y burnout")).toBeInTheDocument();
  });

  it("hydrates session settings (turnos/ritmo/modo) from GET", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Turnos por tema")).toHaveValue("3"));
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Modo de seguridad en vivo")).toHaveValue("live_safe");
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded agenda", async () => {
    server.use(agendaGetErrorHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("agenda-now")).not.toBeInTheDocument();
  });

  it("shows an empty-queue message when GET returns no queued topics", async () => {
    server.use(agendaGetHandler({ ...defaultAgenda, queued_topics: [] }));
    renderPanel();
    await waitFor(() => expect(screen.getByText("No hay temas en cola todavía.")).toBeInTheDocument());
  });
});

describe("AgendaPanel queue actions fire POST /api/agenda/topic/action", () => {
  it("moving a topic up sends action=move with a negative direction and the topic id", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaTopicActionCaptureHandler(capture));
    renderPanel();

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

    await screen.findByText("Streamers y burnout");
    fireEvent.click(screen.getByRole("button", { name: /Quitar "Streamers y burnout"/ }));

    await waitFor(() => expect(capture.body).toEqual({ action: "remove", topic_id: "topic-2" }));
  });
});

describe("AgendaPanel add-topic form fires POST /api/agenda/topic", () => {
  it("rejects an empty title client-side without hitting the network", async () => {
    renderPanel();
    await screen.findByLabelText("Turnos por tema");
    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El título no puede estar vacío.");
  });

  it("adds a valid topic and it appears in the hydrated queue", async () => {
    renderPanel();
    await screen.findByLabelText("Turnos por tema");

    fireEvent.change(screen.getByLabelText("Título del tema"), { target: { value: "Un tema nuevo" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));

    await waitFor(() => expect(screen.getByText("Un tema nuevo")).toBeInTheDocument());
    expect(screen.getByLabelText("Título del tema")).toHaveValue("");
  });

  it("surfaces a 422 validation error from the backend", async () => {
    server.use(agendaTopicValidationHandler("El título parece código"));
    renderPanel();
    await screen.findByLabelText("Turnos por tema");

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
    await waitFor(() => expect(screen.getByLabelText("Turnos por tema")).toHaveValue("3"));

    fireEvent.change(screen.getByLabelText("Turnos por tema"), { target: { value: "5" } });

    await waitFor(() => expect(capture.body).toEqual({ max_turns_per_topic: 5 }));
  });

  it("changing ritmo sends only rhythm", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionCaptureHandler(capture));
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Turnos por tema")).toHaveValue("3"));

    fireEvent.click(screen.getByRole("button", { name: "Dinámico" }));

    await waitFor(() => expect(capture.body).toEqual({ rhythm: "dinamico" }));
  });

  it("changing modo de seguridad sends only safety_mode", async () => {
    const capture: { body?: unknown } = {};
    server.use(agendaSessionCaptureHandler(capture));
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Turnos por tema")).toHaveValue("3"));

    fireEvent.change(screen.getByLabelText("Modo de seguridad en vivo"), { target: { value: "monologue" } });

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
    await screen.findByLabelText("Turnos por tema");

    // AGENDA_FIXTURE.session_state is "active" ("activa") — the live state must win instead.
    expect(screen.getByText("pausa suave")).toBeInTheDocument();
    expect(screen.queryByText("activa")).not.toBeInTheDocument();
  });
});

describe("AgendaPanel profile name reflects live GET /api/status, not AGENDA_FIXTURE", () => {
  it("seeds the profile name from status.active_profile instead of the fixture", async () => {
    server.use(frozenStatusHandler(1, { active_profile: "Perfil en vivo" }));
    renderPanel();
    await screen.findByLabelText("Turnos por tema");

    expect(screen.getByText("Perfil en vivo")).toBeInTheDocument();
    expect(screen.queryByText(AGENDA_FIXTURE.profile.name)).not.toBeInTheDocument();
  });
});

describe("AgendaPanel keeps unwired sections honestly mocked/disabled", () => {
  it("still discloses that suggestions have no backend generation route", async () => {
    renderPanel();
    await screen.findByLabelText("Turnos por tema");
    expect(screen.getByText(/no existe POST/)).toBeInTheDocument();
  });

  it("still discloses that session activation has no backend verb", async () => {
    renderPanel();
    await screen.findByLabelText("Turnos por tema");
    expect(screen.getByText(/no existe todavía un endpoint POST/)).toBeInTheDocument();
  });

  it("keeps session activation buttons permanently disabled — no fake convergence", async () => {
    renderPanel();
    await screen.findByLabelText("Turnos por tema");
    expect(screen.getByRole("button", { name: "Activar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pausa suave" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Emergencia" })).toBeDisabled();
  });
});
