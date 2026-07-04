import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  chatTurnConflictHandler,
  chatTurnNetworkErrorHandler,
  chatTurnQueueFullHandler,
  chatTurnValidationHandler
} from "../test/handlers.js";
import { ConversationPanel } from "./ConversationPanel.js";

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

describe("ConversationPanel", () => {
  it("shows the canned Kira turn seeded from the default transcript", () => {
    renderPanel();
    expect(screen.getByText(/Preparando el motor/)).toBeInTheDocument();
  });

  it("switches the active filter tab and marks aria-selected", () => {
    renderPanel();
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    fireEvent.click(chatTab);
    expect(chatTab).toHaveAttribute("aria-selected", "true");
  });

  it("filters the visible turns by tab and wires honest tab<->tabpanel ARIA", () => {
    renderPanel();
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    const alertasTab = screen.getByRole("tab", { name: "Alertas" });

    // Todo (default): both a chat turn and the alert are visible.
    const todoPanel = screen.getByRole("tabpanel");
    expect(todoPanel).toHaveTextContent(/Preparando el motor/);
    expect(todoPanel).toHaveTextContent(/silenciado/);

    fireEvent.click(chatTab);
    const chatPanel = screen.getByRole("tabpanel");
    expect(chatTab).toHaveAttribute("aria-controls", chatPanel.id);
    expect(chatPanel).toHaveAttribute("aria-labelledby", chatTab.id);
    expect(chatPanel).toHaveTextContent(/Preparando el motor/);
    expect(chatPanel).not.toHaveTextContent(/silenciado/);

    fireEvent.click(alertasTab);
    const alertasPanel = screen.getByRole("tabpanel");
    expect(alertasTab).toHaveAttribute("aria-controls", alertasPanel.id);
    expect(alertasPanel).toHaveAttribute("aria-labelledby", alertasTab.id);
    expect(alertasPanel).toHaveTextContent(/silenciado/);
    expect(alertasPanel).not.toHaveTextContent(/Preparando el motor/);
  });
});

describe("ConversationPanel composer — wired to POST /api/chat/turn", () => {
  it("POSTs the typed text with an Idempotency-Key header, shows the operator's own message, and clears the input on accept", async () => {
    let capturedHeader: string | null = null;
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
        capturedHeader = request.headers.get("Idempotency-Key");
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-chat-1", status: "queued", state_version: 2 });
      })
    );
    renderPanel();

    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "¿Cómo viene el stream hoy?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(capturedBody).toEqual({ text: "¿Cómo viene el stream hoy?" }));
    expect(capturedHeader).toBeTruthy();

    // Operator's own message appears as a turn ("Vos").
    expect(screen.getAllByText("¿Cómo viene el stream hoy?").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vos").length).toBeGreaterThan(0);

    await waitFor(() => expect(input.value).toBe(""));
  });

  it("disables Enviar while the turn is pending", async () => {
    let resolveRequest!: () => void;
    server.use(
      http.post(
        `${API_BASE_URL}/api/chat/turn`,
        () =>
          new Promise((resolve) => {
            resolveRequest = () =>
              resolve(HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 }));
          })
      )
    );
    renderPanel();

    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled());
    resolveRequest();
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).not.toBeDisabled());
  });

  it("surfaces a 409 conflict honestly via role=alert", async () => {
    server.use(chatTurnConflictHandler());
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
  });

  it("surfaces a 429 queue-full error honestly", async () => {
    server.use(chatTurnQueueFullHandler());
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("surfaces a 422 validation error with the backend detail", async () => {
    server.use(chatTurnValidationHandler("text must be non-empty"));
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("text must be non-empty"));
  });

  it("surfaces a network error honestly", async () => {
    server.use(chatTurnNetworkErrorHandler());
    renderPanel();

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("does not submit an empty/whitespace-only message", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a second submit while a send is pending (double-submit guard)", async () => {
    let resolveRequest!: () => void;
    let postCount = 0;
    server.use(
      http.post(
        `${API_BASE_URL}/api/chat/turn`,
        () =>
          new Promise((resolve) => {
            postCount += 1;
            resolveRequest = () =>
              resolve(HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 }));
          })
      )
    );
    renderPanel();

    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…") as HTMLInputElement;
    const form = input.closest("form") as HTMLFormElement;
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled());

    // A repeated submit while pending (e.g. rapid Enter) must be a no-op.
    fireEvent.submit(form);

    expect(postCount).toBe(1);
    expect(screen.getAllByText("hola")).toHaveLength(1);

    resolveRequest();
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).not.toBeDisabled());
  });

  it("does not duplicate the Vos bubble when retrying after a failed send", async () => {
    server.use(chatTurnNetworkErrorHandler());
    renderPanel();

    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getAllByText("hola")).toHaveLength(1);
    expect(input.value).toBe("hola"); // kept in the input so the retry below resubmits it

    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-retry", status: "queued", state_version: 3 })
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(input.value).toBe(""));
    expect(screen.getAllByText("hola")).toHaveLength(1);
  });
});
