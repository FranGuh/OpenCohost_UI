import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  defaultStreamChatLive,
  streamConnectInvalidUrlHandler,
  streamLimitsValidationHandler
} from "../../test/handlers.js";
import { StreamPanel } from "./StreamPanel.js";
import { STREAM_FIXTURE } from "../../api/mock/fixtures.js";

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(StreamPanel)));
}

function selectCustomOption(comboboxName: string | RegExp, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
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

  it("hydrates the URL field from an already-connected channel instead of showing stale fixture text", async () => {
    // Reload scenario (owner report): the backend already reports a
    // connected channel before the operator touches anything.
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, connected: true, platform: "twitch", source_id: "kira" })
      )
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());
    expect(screen.getByLabelText("URL del directo")).toHaveValue("twitch.tv/kira");
    expect(screen.getByLabelText("URL del directo")).toBeDisabled();
  });

  it("never overwrites a URL the operator is actively typing while disconnected", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "https://twitch.tv/inflight" } });
    // Let GET /api/stream/chat-live settle — AccionesCard's own hydration
    // (a sibling effect fed by the same query) is the observable signal.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).toHaveTextContent(
        String(defaultStreamChatLive.threshold_per_second)
      )
    );
    expect(screen.getByLabelText("URL del directo")).toHaveValue("https://twitch.tv/inflight");
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

  it("shows a single Conectar/Desconectar toggle, never two separate controls", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Conectar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desconectar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Desconectar del chat en vivo")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "https://twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: "Conectar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desconectar" })).not.toBeDisabled();
  });

  it("toggling to Desconectar disconnects without re-submitting a connect request", async () => {
    let connectCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () => {
        connectCalls += 1;
        return HttpResponse.json({ ...defaultStreamChatLive, connected: true, platform: "twitch", source_id: "kira" });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "https://twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());
    expect(connectCalls).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(screen.getByText("desconectado")).toBeInTheDocument());

    // A toggle whose job is to disconnect must never re-trigger the form's
    // connect submit handler.
    expect(connectCalls).toBe(1);
    expect(screen.getByLabelText("URL del directo")).not.toBeDisabled();
  });

  it("hydrates the reaction threshold and cooldown selects from GET /api/stream/chat-live", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).toHaveTextContent(String(defaultStreamChatLive.threshold_per_second))
    );
    expect(screen.getByRole("combobox", { name: "Cooldown entre reacciones" })).toHaveTextContent(String(defaultStreamChatLive.cooldown_seconds));
    expect(screen.getByRole("combobox", { name: "Límite de spam" })).toHaveTextContent(String(defaultStreamChatLive.max_messages_per_user));
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
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).not.toBeDisabled());

    selectCustomOption("Umbral de reacciones", "3 msg/s");

    await waitFor(() => expect(capturedBody).toEqual({ threshold_per_second: 3 }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).toHaveTextContent("3 msg/s"));
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
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).not.toBeDisabled());

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
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Cooldown entre reacciones" })).not.toBeDisabled());

    selectCustomOption("Cooldown entre reacciones", "30 s");

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
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Límite de spam" })).not.toBeDisabled());

    selectCustomOption("Límite de spam", "20 msgs/usuario en 30s");

    await waitFor(() => expect(capturedBody).toEqual({ max_messages_per_user: 20 }));
  });

  it("Small Stream switch reads OFF against the smart_aggregator.yaml defaults defaultStreamChatLive already carries", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Stream pequeño" })).not.toBeDisabled());
    expect(screen.getByRole("switch", { name: "Stream pequeño" })).toHaveAttribute("aria-checked", "false");
  });

  it("Small Stream switch reads ON straight from backend values it was never clicked to produce, proving it isn't local click state", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({
          ...defaultStreamChatLive,
          threshold_per_second: 0.2,
          cooldown_seconds: 20,
          max_messages_per_user: 30
        })
      )
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Stream pequeño" })).toHaveAttribute("aria-checked", "true")
    );
  });

  it("turning Small Stream ON fires PUT /api/stream/chat-live/limits with the CTK's exact values", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          ...defaultStreamChatLive,
          threshold_per_second: 0.2,
          cooldown_seconds: 20,
          max_messages_per_user: 30
        });
      })
    );
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Stream pequeño" });
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(capturedBody).toEqual({ threshold_per_second: 0.2, cooldown_seconds: 20, max_messages_per_user: 30 })
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("turning Small Stream OFF restores the smart_aggregator.yaml defaults, including spam (a superset of the CTK's own OFF path)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({
          ...defaultStreamChatLive,
          threshold_per_second: 0.2,
          cooldown_seconds: 20,
          max_messages_per_user: 30
        })
      )
    );
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(defaultStreamChatLive);
      })
    );
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Stream pequeño" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(capturedBody).toEqual({ threshold_per_second: 1, cooldown_seconds: 45, max_messages_per_user: 10 })
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("Adaptive switch reads OFF when the backend doesn't carry adaptive_activation", async () => {
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Activación adaptativa" });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("Adaptive switch reads ON straight from backend adaptive_activation", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, adaptive_activation: true })
      )
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Activación adaptativa" })).toHaveAttribute("aria-checked", "true")
    );
  });

  it("turning Adaptive ON fires PUT /api/stream/chat-live/limits with adaptive_activation: true", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, adaptive_activation: true });
      })
    );
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Activación adaptativa" });
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);

    await waitFor(() => expect(capturedBody).toEqual({ adaptive_activation: true }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("does NOT grey out or lock the reaction Select or Small Stream switch while Adaptive is on", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, adaptive_activation: true })
      )
    );
    renderPanel();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Activación adaptativa" })).toHaveAttribute("aria-checked", "true")
    );
    expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).not.toBeDisabled();
    expect(screen.getByRole("switch", { name: "Stream pequeño" })).not.toBeDisabled();
  });

  it("Adaptive switch reflects a silent backend-driven OFF after a manual threshold change (owner override), without the switch itself ever being clicked", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, adaptive_activation: true })
      ),
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        // Mirrors the real backend: a manual threshold_per_second write
        // silently disables adaptive (routers/stream.py::put_stream_limits).
        return HttpResponse.json({ ...defaultStreamChatLive, ...body, adaptive_activation: false });
      })
    );
    renderPanel();
    const adaptiveToggle = screen.getByRole("switch", { name: "Activación adaptativa" });
    await waitFor(() => expect(adaptiveToggle).toHaveAttribute("aria-checked", "true"));

    selectCustomOption("Umbral de reacciones", "3 msg/s");

    await waitFor(() => expect(adaptiveToggle).toHaveAttribute("aria-checked", "false"));
  });

  it("shows a confirmation alert once a limit change lands", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...defaultStreamChatLive, ...body });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).not.toBeDisabled());

    selectCustomOption("Umbral de reacciones", "3 msg/s");

    await waitFor(() => expect(screen.getByText("Cambio aplicado.")).toBeInTheDocument());
  });

  it("shows an error alert when applying a limit change fails, instead of leaving no signal at all", async () => {
    server.use(streamLimitsValidationHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).not.toBeDisabled());

    selectCustomOption("Umbral de reacciones", "3 msg/s");

    await waitFor(() => expect(screen.getByText("No se pudo aplicar el cambio.")).toBeInTheDocument());
  });

  it("Input Contract switch is enabled and hydrates from GET /api/stream/chat-live", async () => {
    // threshold_per_second also overridden (away from the fixture's own
    // default of 1) so waiting on it actually proves the fetch resolved,
    // instead of a combobox that already reads right pre-hydration.
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, input_contract: true, threshold_per_second: 3 })
      )
    );
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Umbral de reacciones" })).toHaveTextContent("3 msg/s"));
    expect(screen.getByRole("switch", { name: "Input Contract" })).toHaveAttribute("aria-checked", "true");
  });

  it("flipping Input Contract fires PUT /api/stream/chat-live/limits with the new value", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, input_contract: true });
      })
    );
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Input Contract" });
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);

    await waitFor(() => expect(capturedBody).toEqual({ input_contract: true }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("hydrates the Orden switch and Vigencia select from GET /api/stream/chat-live", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, stream_over_agenda: true, stream_ttl_seconds: 120, effective_stream_ttl_seconds: 120 })
      )
    );
    renderPanel();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Chat antes que la agenda" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("combobox", { name: "Vigencia de reacciones en cola" })).toHaveTextContent("120 s");
  });

  it("flipping Orden fires PUT /api/stream/chat-live/limits with the new value", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, stream_over_agenda: true });
      })
    );
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Chat antes que la agenda" });
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);

    await waitFor(() => expect(capturedBody).toEqual({ stream_over_agenda: true }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("surfaces a failure when flipping Orden fails, same as the other Acciones controls", async () => {
    server.use(streamLimitsValidationHandler());
    renderPanel();
    const toggle = screen.getByRole("switch", { name: "Chat antes que la agenda" });
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByText("No se pudo aplicar el cambio.")).toBeInTheDocument());
  });

  it("changing the Vigencia select fires PUT /api/stream/chat-live/limits", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultStreamChatLive, stream_ttl_seconds: 60, effective_stream_ttl_seconds: 300 });
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Vigencia de reacciones en cola" })).not.toBeDisabled());

    selectCustomOption("Vigencia de reacciones en cola", "60 s");

    await waitFor(() => expect(capturedBody).toEqual({ stream_ttl_seconds: 60 }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Vigencia de reacciones en cola" })).toHaveTextContent("60 s"));
  });

  it("stays quiet about the effective TTL when the chosen and effective windows match", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Vigencia de reacciones en cola" })).not.toBeDisabled());
    expect(screen.queryByText("La ventana real no es la que elegiste")).not.toBeInTheDocument();
  });

  it("discloses the effective TTL as an explanatory notice when the agenda-first floor diverges it from the chosen value", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, stream_over_agenda: false, stream_ttl_seconds: 60, effective_stream_ttl_seconds: 300 })
      )
    );
    renderPanel();
    const notice = await screen.findByText("La ventana real no es la que elegiste");
    // role="status" (not "alert"/danger tone) — this reads as an explanation
    // of the floor protecting the streamer, not an error condition.
    expect(notice.closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByText(/elegiste 60s/)).toBeInTheDocument();
    expect(screen.getByText(/piso de 300s/)).toBeInTheDocument();
  });

  it("clears the effective-TTL disclosure again once a follow-up change brings chosen and effective back in sync", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, stream_ttl_seconds: 60, effective_stream_ttl_seconds: 300 })
      ),
      http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, () =>
        HttpResponse.json({ ...defaultStreamChatLive, stream_ttl_seconds: 300, effective_stream_ttl_seconds: 300 })
      )
    );
    renderPanel();
    await screen.findByText("La ventana real no es la que elegiste");

    selectCustomOption("Vigencia de reacciones en cola", "300 s");

    await waitFor(() => expect(screen.queryByText("La ventana real no es la que elegiste")).not.toBeInTheDocument());
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
    // RF3: the chat-readout banner (stream.chatReadout.*) now legitimately
    // says "viewers" as a plain category noun — pointing the operator at the
    // Stream tab — so a bare /viewer/i text match is no longer a useful
    // signal on its own. The actual R8 guarantee is that no message-SHAPED
    // content (an author/text pair, or the field names themselves) ever
    // renders here, which this still checks.
    expect(document.body.textContent).not.toMatch(/mensaje de|viewer_message|chat_text/i);
  });

  it("shows the chat-readout notice ahead of the cards, without disabling any existing control", async () => {
    renderPanel();
    expect(screen.getByText("El chat en vivo se lee en la pestaña Stream")).toBeInTheDocument();
    expect(screen.getByText(/se lee desde la pestaña Stream del panel de conversación/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Conectar" })).not.toBeDisabled());
  });

  it("shows a risk disclaimer covering the ban-risk and cloud-disclosure clauses, without disabling anything", async () => {
    renderPanel();
    // Ban risk (platform policy alert) — a test that only checked a generic
    // "this is risky" phrase would still pass with the real content deleted.
    expect(screen.getByText(/riesgo real de ban en YouTube/i)).toBeInTheDocument();
    // Cloud disclosure (verified 2026-08-12: cloud_llm_client.py posts
    // `messages` unredacted, and chat_reaction.py's highlight carries the
    // viewer's username) — asserts the actual disclosed mechanism, not just
    // that "some cloud text" exists somewhere.
    // Matches the CONDITION, not one phrasing of it: the clause is only honest
    // if it says cloud-instead-of-local, and that pairing is what must survive
    // a copy edit. Pinning the whole sentence made a register fix fail the
    // build for no defect.
    expect(screen.getByText(/en la nube en vez de un modelo local/i)).toBeInTheDocument();
    expect(screen.getByText(/nombre de usuario de quien lo escribió/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Conectar" })).not.toBeDisabled());
  });

  it("shows a single non-interactive deferred note for the RF4 Emisión area (OAuth/metadata/moderación)", async () => {
    renderPanel();
    const heading = screen.getByRole("heading", { name: /Emisión/ });
    expect(heading).toBeInTheDocument();
    const card = heading.closest("div")?.parentElement as HTMLElement;
    // The Collapsible body is the last child of the Card. We scope the query to it
    // so we don't accidentally count the CollapsibleHeader (which has role=button).
    const body = card.lastElementChild as HTMLElement;
    expect(within(body).queryAllByRole("button")).toHaveLength(0);
    expect(within(body).queryAllByRole("textbox")).toHaveLength(0);
  });
});
