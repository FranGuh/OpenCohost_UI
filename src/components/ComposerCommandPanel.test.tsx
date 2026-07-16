import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { useEventStore } from "../store/eventStore.js";
import { ConversationPanel } from "./ConversationPanel.js";

// The palette is only reachable through the composer, so it's driven end-to-end
// via ConversationPanel (which owns the live "/"|"!" prefix detection).
function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

function typeComposer(value: string) {
  fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value } });
}

beforeEach(() => {
  useEventStore.setState({ events: [] });
});

describe("ComposerCommandPanel (chat command palette — mockup)", () => {
  it("does NOT render until the composer value starts with '/' or '!'", () => {
    renderPanel();
    expect(screen.queryByRole("dialog", { name: "Comandos del chat" })).not.toBeInTheDocument();
    typeComposer("hola");
    expect(screen.queryByRole("dialog", { name: "Comandos del chat" })).not.toBeInTheDocument();
  });

  it("appears on a '/' prefix and lists the agenda command", () => {
    renderPanel();
    typeComposer("/");
    const dialog = screen.getByRole("dialog", { name: "Comandos del chat" });
    expect(dialog).toHaveTextContent("/agenda");
    expect(dialog).toHaveTextContent("programá un tema para el stream");
  });

  it("also appears on a '!' prefix (same command namespace)", () => {
    renderPanel();
    typeComposer("!ag");
    expect(screen.getByRole("dialog", { name: "Comandos del chat" })).toHaveTextContent("/agenda");
  });

  it("filters live: '/ag' still matches agenda, '/xyz' is an unknown command", () => {
    renderPanel();
    typeComposer("/ag");
    expect(screen.getByRole("dialog", { name: "Comandos del chat" })).toHaveTextContent("/agenda");

    typeComposer("/xyz");
    const dialog = screen.getByRole("dialog", { name: "Comandos del chat" });
    expect(dialog).toHaveTextContent("comando desconocido");
    expect(dialog).not.toHaveTextContent("programá un tema");
  });

  // The /agenda command was extended to the full editorial contract: tema →
  // ángulo → prioridad → largo → etiquetas → summary. This walks the new order
  // and proves the one-at-a-time + collapsing-chip behavior is preserved.
  it("advances the stepper one question at a time (tema → ángulo → …)", () => {
    renderPanel();
    typeComposer("/agenda");

    // Enter the stepper from the command entry.
    fireEvent.click(screen.getByRole("button", { name: /agenda — programá un tema/ }));

    // Step 1: only the tema question is visible.
    expect(screen.getByText("¿Qué tema querés agendar?")).toBeInTheDocument();
    expect(screen.queryByText("¿Cómo querés que Kira lo trate?")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("¿Qué tema querés agendar?"), { target: { value: "mods retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    // Step 2: ángulo question, and the answered tema collapsed to a chip.
    expect(screen.getByText("¿Cómo querés que Kira lo trate?")).toBeInTheDocument();
    expect(screen.getByText("mods retro")).toBeInTheDocument();
    expect(screen.queryByText("¿Qué tema querés agendar?")).not.toBeInTheDocument();
  });

  it("keeps the primary 'Programar tema' action disabled (maquetado) at the summary", () => {
    renderPanel();
    typeComposer("/agenda");
    fireEvent.click(screen.getByRole("button", { name: /agenda — programá un tema/ }));

    // The inert action now lives on the SummaryCard — walk the whole flow.
    fireEvent.change(screen.getByLabelText("¿Qué tema querés agendar?"), { target: { value: "mods retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → ángulo
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → prioridad
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → largo
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → etiquetas (last)
    fireEvent.click(screen.getByRole("button", { name: "Revisar" })); // → summary

    const programar = screen.getByRole("button", { name: "Programar tema" });
    expect(programar).toBeDisabled();
    expect(screen.getByText("maquetado — todavía no envía")).toBeInTheDocument();
  });

  it("closes on Escape and clears the composer", () => {
    renderPanel();
    typeComposer("/agenda");
    expect(screen.getByRole("dialog", { name: "Comandos del chat" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Comandos del chat" })).not.toBeInTheDocument();
    expect((screen.getByPlaceholderText("Escribí un mensaje para Kira…") as HTMLInputElement).value).toBe("");
  });

  it("closes on Cancelar, restoring the composer", () => {
    renderPanel();
    typeComposer("/agenda");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "Comandos del chat" })).not.toBeInTheDocument();
  });

  it("makes NO agenda/chat network calls while mocking up (inert final action)", async () => {
    let agendaPosts = 0;
    let chatPosts = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/agenda/topic`, () => {
        agendaPosts += 1;
        return HttpResponse.json({ detail: "should not be called" }, { status: 500 });
      }),
      http.post(`${API_BASE_URL}/api/chat/turn`, () => {
        chatPosts += 1;
        return HttpResponse.json({ accepted: true, command_id: "cmd", status: "queued", state_version: 2 });
      })
    );
    renderPanel();

    // Drive the flow through several steps of the mockup stepper.
    typeComposer("/agenda");
    fireEvent.click(screen.getByRole("button", { name: /agenda — programá un tema/ }));
    fireEvent.change(screen.getByLabelText("¿Qué tema querés agendar?"), { target: { value: "mods retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → ángulo
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → prioridad

    // Also prove Enter in the composer never sends a "/"-prefixed command as chat.
    fireEvent.submit(screen.getByPlaceholderText("Escribí un mensaje para Kira…").closest("form") as HTMLFormElement);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(agendaPosts).toBe(0);
    expect(chatPosts).toBe(0);
  });
});
