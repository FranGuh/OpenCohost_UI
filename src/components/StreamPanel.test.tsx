import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStreamChatLive, streamConnectInvalidUrlHandler } from "../test/handlers.js";
import { StreamPanel } from "./StreamPanel.js";
import { STREAM_FIXTURE } from "../api/mock/fixtures.js";

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(StreamPanel)));
}

describe("StreamPanel", () => {
  it("renders the Chat en vivo URL input and Conectar button, starting desconectado", async () => {
    renderPanel();
    expect(screen.getByLabelText("URL del directo")).toHaveValue(STREAM_FIXTURE.url);
    expect(screen.getByRole("button", { name: "Conectar" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());
  });

  it("rejects an invalid URL shape locally without ever calling POST /api/stream/chat-live/connect", async () => {
    let called = false;
    server.use(
      http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () => {
        called = true;
        return HttpResponse.json({ ...defaultStreamChatLive, connected: true });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "no es una url" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("desconectado")).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("connects with a valid URL by firing POST /api/stream/chat-live/connect and reflects the returned state", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "https://twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Desconectar" })).not.toBeDisabled();
  });

  it("surfaces a connect error honestly instead of faking conectado", async () => {
    server.use(streamConnectInvalidUrlHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "https://twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("desconectado")).toBeInTheDocument();
  });

  it("disconnects back to desconectado by firing POST /api/stream/chat-live/disconnect", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "https://twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));

    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());
  });

  it("Desconectar stays disabled while not connected", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: "Desconectar" })).toBeDisabled());
  });

  it("hydrates the reaction threshold and cooldown selects from GET /api/stream/chat-live", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByLabelText("Umbral de reacciones")).toHaveValue(String(defaultStreamChatLive.threshold_per_second))
    );
    expect(screen.getByLabelText("Cooldown entre reacciones")).toHaveValue(String(defaultStreamChatLive.cooldown_seconds));
    expect(screen.getByLabelText("Límite de spam")).toHaveValue(String(defaultStreamChatLive.max_messages_per_user));
  });

  it("changing the reaction threshold select fires PUT /api/stream/chat-live/limits", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, threshold_per_second: 3 });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Umbral de reacciones")).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText("Umbral de reacciones"), { target: { value: "3" } });

    await waitFor(() => expect(capturedBody).toEqual({ threshold_per_second: 3 }));
    await waitFor(() => expect(screen.getByLabelText("Umbral de reacciones")).toHaveValue("3"));
  });

  it("selecting a reaction preset fires PUT /api/stream/chat-live/limits with the preset value", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, threshold_per_second: 3 });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Umbral de reacciones")).not.toBeDisabled());

    const altoButtons = screen.getAllByRole("button", { name: "Alto" });
    fireEvent.click(altoButtons[0]);

    await waitFor(() => expect(capturedBody).toEqual({ threshold_per_second: 3 }));
  });

  it("changing the cooldown select fires PUT /api/stream/chat-live/limits", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, cooldown_seconds: 30 });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Cooldown entre reacciones")).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText("Cooldown entre reacciones"), { target: { value: "30" } });

    await waitFor(() => expect(capturedBody).toEqual({ cooldown_seconds: 30 }));
  });

  it("changing the spam select fires PUT /api/stream/chat-live/limits", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, max_messages_per_user: 20 });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Límite de spam")).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText("Límite de spam"), { target: { value: "20" } });

    await waitFor(() => expect(capturedBody).toEqual({ max_messages_per_user: 20 }));
  });

  it("Input Contract switch stays honestly disabled — no fake convergence (filter_policy preset mapping undecided)", async () => {
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Input Contract" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", String(STREAM_FIXTURE.input_contract));

    fireEvent.click(toggle);

    // Disabled buttons don't fire onClick, so nothing should ever flip.
    expect(toggle).toHaveAttribute("aria-checked", String(STREAM_FIXTURE.input_contract));
    expect(toggle).toBeDisabled();
  });

  it("associates each threshold Select with its visible helper text via aria-describedby", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("Umbral de reacciones")).not.toBeDisabled());

    const reactionSelect = screen.getByLabelText("Umbral de reacciones");
    const reactionHelperId = reactionSelect.getAttribute("aria-describedby");
    expect(reactionHelperId).toBeTruthy();
    expect(document.getElementById(reactionHelperId!)).toHaveTextContent("Reaccionar si el chat supera");

    const cooldownSelect = screen.getByLabelText("Cooldown entre reacciones");
    const cooldownHelperId = cooldownSelect.getAttribute("aria-describedby");
    expect(cooldownHelperId).toBeTruthy();
    expect(document.getElementById(cooldownHelperId!)).toHaveTextContent("Esperar al menos, entre reacciones");

    const spamSelect = screen.getByLabelText("Límite de spam");
    const spamHelperId = spamSelect.getAttribute("aria-describedby");
    expect(spamHelperId).toBeTruthy();
    expect(document.getElementById(spamHelperId!)).toHaveTextContent("Límite de mensajes repetidos");
  });

  it("R8: never renders any viewer-chat-message content anywhere in the panel", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        // Even if the backend contract were ever violated and leaked a
        // message-shaped field, the panel must not render it — it only
        // reads the fixed StreamChatLiveResponse fields.
        HttpResponse.json({ ...defaultStreamChatLive, connected: true, platform: "twitch", source_id: "kira" })
      )
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());
    expect(screen.queryByText(/viewer/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/mensaje de|viewer_message|chat_text/i);
  });

  it("shows a single non-interactive deferred note for the RF4 Emisión area (OAuth/metadata/moderación)", async () => {
    renderPanel();
    const heading = screen.getByRole("heading", { name: /Emisión/ });
    expect(heading).toBeInTheDocument();
    const card = heading.closest("div")?.parentElement as HTMLElement;
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryAllByRole("textbox")).toHaveLength(0);
  });
});
