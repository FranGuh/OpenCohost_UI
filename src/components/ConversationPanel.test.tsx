import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { useEventStore } from "../store/eventStore.js";
import {
  API_BASE_URL,
  chatTurnConflictHandler,
  chatTurnNetworkErrorHandler,
  chatTurnQueueFullHandler,
  chatTurnValidationHandler,
  defaultAgenda,
  evolvingAgendaHandler,
  evolvingLastReplyHandler,
  lastReplyHandler,
  pttSessionFlowHandlers,
  pttStartUnreachableHandler
} from "../test/handlers.js";
import { ConversationPanel } from "./ConversationPanel.js";

// The LiveAudio WS echo hook is unit-tested in src/api/liveTranscript.test.ts;
// here it's mocked down to its contract — "fires the callback with the final
// spoken text at most once per hold" — so panel tests drive the append/render
// path directly instead of re-mocking WebSocket + the state poll.
let liveTranscriptCb: ((text: string) => void) | null = null;
vi.mock("../api/liveTranscript.js", () => ({
  useLiveTranscript: (cb: (text: string) => void) => {
    liveTranscriptCb = cb;
  }
}));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

beforeEach(() => {
  useEventStore.setState({ events: [] });
  liveTranscriptCb = null;
});

describe("ConversationPanel", () => {
  it("renders Kira's fetched reply, not a canned transcript", async () => {
    server.use(lastReplyHandler({ text: "todo joya, arrancamos con el stream", turn_id: 1 }));
    renderPanel();
    expect(await screen.findByText("todo joya, arrancamos con el stream")).toBeInTheDocument();
  });

  it("renders nothing for Kira when no reply has landed yet (text: null)", () => {
    renderPanel();
    expect(screen.queryByText("KIRA")).not.toBeInTheDocument();
  });

  it("switches the active filter tab and marks aria-selected", () => {
    renderPanel();
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    fireEvent.click(chatTab);
    expect(chatTab).toHaveAttribute("aria-selected", "true");
  });

  it("filters the visible turns by tab and wires honest tab<->tabpanel ARIA", async () => {
    server.use(lastReplyHandler({ text: "todo bien por acá", turn_id: 1 }));
    // The muted-viewers notice is no longer an in-timeline alert (it now
    // anchors above the composer); use an injected app-event divider as the
    // alert-kind turn this filtering test asserts against.
    act(() => {
      useEventStore
        .getState()
        .append({ id: "e-filter", ts: Date.now(), source: "model", label: "Modelo → qwen3:8b", tone: "ok" });
    });
    renderPanel();
    await screen.findByText("todo bien por acá");
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    const alertasTab = screen.getByRole("tab", { name: "Alertas" });

    // Todo (default): both a chat turn and the alert-kind divider are visible.
    const todoPanel = screen.getByRole("tabpanel");
    expect(todoPanel).toHaveTextContent(/todo bien por acá/);
    expect(todoPanel).toHaveTextContent(/Modelo → qwen3:8b/);

    fireEvent.click(chatTab);
    const chatPanel = screen.getByRole("tabpanel");
    expect(chatTab).toHaveAttribute("aria-controls", chatPanel.id);
    expect(chatPanel).toHaveAttribute("aria-labelledby", chatTab.id);
    expect(chatPanel).toHaveTextContent(/todo bien por acá/);
    expect(chatPanel).not.toHaveTextContent(/Modelo → qwen3:8b/);

    fireEvent.click(alertasTab);
    const alertasPanel = screen.getByRole("tabpanel");
    expect(alertasTab).toHaveAttribute("aria-controls", alertasPanel.id);
    expect(alertasPanel).toHaveAttribute("aria-labelledby", alertasTab.id);
    expect(alertasPanel).toHaveTextContent(/Modelo → qwen3:8b/);
    expect(alertasPanel).not.toHaveTextContent(/todo bien por acá/);
  });
});

describe("ConversationPanel — empty state + viewers-muted banner (P3/§3b)", () => {
  it("shows the Kira empty-state invitation on Todo when no chat turns have landed", () => {
    renderPanel();
    expect(screen.getByText("Empezá a chatear con Kira")).toBeInTheDocument();
    expect(screen.getByText(/mantené el micrófono para hablarle/i)).toBeInTheDocument();
  });

  it("keeps the invitation even when only alert-kind event lines exist (motor.* must not kill it)", () => {
    act(() => {
      useEventStore.getState().append({ id: "e-motor", ts: Date.now(), source: "model", label: "Motor: listo", tone: "ok" });
    });
    renderPanel();
    expect(screen.getByText("Empezá a chatear con Kira")).toBeInTheDocument();
    expect(screen.getByText("Motor: listo")).toBeInTheDocument();
  });

  it("dismisses the invitation once a chat turn lands", async () => {
    server.use(lastReplyHandler({ text: "hola operador", turn_id: 1 }));
    renderPanel();
    await screen.findByText("hola operador");
    expect(screen.queryByText("Empezá a chatear con Kira")).not.toBeInTheDocument();
  });

  it("keeps 'Sin turnos en este filtro.' as the Alertas empty case, not the invitation", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Alertas" }));
    expect(screen.getByText("Sin turnos en este filtro.")).toBeInTheDocument();
    expect(screen.queryByText("Empezá a chatear con Kira")).not.toBeInTheDocument();
  });

  it("anchors the viewers-muted banner exactly once, outside the scrollable timeline", () => {
    renderPanel();
    expect(screen.getAllByText("Chat de viewers silenciado")).toHaveLength(1);
    // The banner lives above the composer, not inside the scroll region.
    expect(screen.getByRole("tabpanel")).not.toHaveTextContent(/Chat de viewers silenciado/);
  });
});

describe("ConversationPanel — composer mic (pure PTT relocation, §3b(vi))", () => {
  it("holds to talk: pointerdown starts a PTT session, pointerup stops it", async () => {
    let startCalls = 0;
    let stopCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/ptt/start`, () => {
        startCalls += 1;
        return HttpResponse.json({ session_id: "s1", state: "listening" });
      }),
      http.post(`${API_BASE_URL}/api/ptt/stop`, () => {
        stopCalls += 1;
        return HttpResponse.json({ state: "flushing" });
      })
    );
    renderPanel();

    const mic = screen.getByRole("button", { name: "Mantené para hablar con Kira" });
    fireEvent.pointerDown(mic, { pointerId: 1 });
    await waitFor(() => expect(startCalls).toBe(1));

    const listeningMic = await screen.findByRole("button", { name: "Escuchando… soltá para enviar" });
    expect(listeningMic).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerUp(listeningMic, { pointerId: 1 });
    await waitFor(() => expect(stopCalls).toBe(1));
  });

  it("registers NO window-level key listener — a window Space never starts PTT from the composer", async () => {
    let startCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/ptt/start`, () => {
        startCalls += 1;
        return HttpResponse.json({ session_id: "s1", state: "listening" });
      })
    );
    renderPanel();

    fireEvent.keyDown(window, { code: "Space" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(startCalls).toBe(0);
  });

  it("confirms the send with a 'Turno de voz enviado' chip after a completed hold", async () => {
    server.use(...pttSessionFlowHandlers(1));
    renderPanel();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Mantené para hablar con Kira" }), { pointerId: 1 });
    const listeningMic = await screen.findByRole("button", { name: "Escuchando… soltá para enviar" });
    fireEvent.pointerUp(listeningMic, { pointerId: 1 });

    await waitFor(() => expect(screen.getByText("Turno de voz enviado")).toBeInTheDocument(), { timeout: 4000 });
  });

  it("surfaces a 503 stt_unreachable honestly in the composer and never fakes listening", async () => {
    server.use(pttStartUnreachableHandler());
    renderPanel();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Mantené para hablar con Kira" }), { pointerId: 1 });

    await waitFor(() => expect(screen.getByText(/STT \(WhisperLive\) no disponible/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Escuchando… soltá para enviar" })).not.toBeInTheDocument();
  });

  it("tints the mic button visibly while connecting (start in flight)", () => {
    server.use(http.post(`${API_BASE_URL}/api/ptt/start`, () => new Promise<never>(() => {}))); // never resolves
    renderPanel();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Mantené para hablar con Kira" }), { pointerId: 1 });

    const connectingMic = screen.getByRole("button", { name: "Conectando…" });
    expect(connectingMic).toHaveClass("bg-info-bg");
    expect(connectingMic).toHaveClass("animate-pulse");

    fireEvent.pointerUp(connectingMic, { pointerId: 1 }); // release: don't leave the hold open
  });

  it("announces the stt_unreachable failure assertively (role=alert), not as a quiet status line", async () => {
    server.use(pttStartUnreachableHandler());
    renderPanel();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Mantené para hablar con Kira" }), { pointerId: 1 });

    const alertLine = await screen.findByRole("alert");
    expect(alertLine).toHaveTextContent(/STT \(WhisperLive\) no disponible/);
  });

  it("fills the mic while HELD (listening) and drains it on release", async () => {
    let stopCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/ptt/start`, () => HttpResponse.json({ session_id: "s1", state: "listening" })),
      http.post(`${API_BASE_URL}/api/ptt/stop`, () => {
        stopCalls += 1;
        return HttpResponse.json({ state: "flushing" });
      })
    );
    renderPanel();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Mantené para hablar con Kira" }), { pointerId: 1 });
    const listeningMic = await screen.findByRole("button", { name: "Escuchando… soltá para enviar" });

    // The fill layer is present and carries the filling class while listening.
    const fill = listeningMic.querySelector(".mic-fill");
    expect(fill).not.toBeNull();
    expect(fill).toHaveClass("mic-fill--filling");

    // Release → no longer filling (it drains); the layer stays mounted.
    fireEvent.pointerUp(listeningMic, { pointerId: 1 });
    await waitFor(() => expect(stopCalls).toBe(1));
    await waitFor(() => expect(listeningMic.querySelector(".mic-fill")).not.toHaveClass("mic-fill--filling"));
  });
});

describe("ConversationPanel — auto-scroll + jump-to-recent (Item 3)", () => {
  // Injects an alert-kind app event, the simplest synchronous append.
  function appendEvent(id: string) {
    act(() => {
      useEventStore.getState().append({ id, ts: Date.now(), source: "model", label: "Modelo → qwen3:8b", tone: "ok" });
    });
  }

  // New rule (owner feedback 2026-07-15): the pill shows WHENEVER the operator
  // is scrolled up past the threshold, not only when new content arrives.
  it("shows the jump pill whenever scrolled up past the threshold — no new content needed — and hides it near the bottom", async () => {
    renderPanel();
    const panel = screen.getByRole("tabpanel");
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;
    Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(panel, "clientHeight", { configurable: true, value: 300 });

    // Scrolled up, nothing appended: distance = 1000 - 0 - 300 = 700 > 80.
    panel.scrollTop = 0;
    fireEvent.scroll(panel);
    expect(await screen.findByRole("button", { name: /Ver lo más reciente/ })).toBeInTheDocument();
    expect(scrollSpy).not.toHaveBeenCalled(); // a scroll gesture must never yank

    // Scrolled back near the bottom: distance = 1000 - 700 - 300 = 0 <= 80.
    panel.scrollTop = 700;
    fireEvent.scroll(panel);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Ver lo más reciente/ })).not.toBeInTheDocument());
  });

  it("smooth-scrolls to the bottom when a turn appends while near the bottom", async () => {
    renderPanel();
    const panel = screen.getByRole("tabpanel");
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;
    // jsdom has no layout: scrollHeight/scrollTop/clientHeight all read 0, so
    // distance-from-bottom is 0 (<= threshold) — i.e. "near the bottom".

    appendEvent("e-near");

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(scrollSpy.mock.calls[0][0]).toMatchObject({ behavior: "smooth" });
    expect(screen.queryByRole("button", { name: /Ver lo más reciente/ })).not.toBeInTheDocument();
  });

  it("shows the jump button (no yank) when a turn appends while scrolled up", async () => {
    renderPanel();
    const panel = screen.getByRole("tabpanel");
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;
    // Force a scrolled-up geometry: distance-from-bottom = 1000 - 0 - 300 = 700 > 80.
    Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(panel, "clientHeight", { configurable: true, value: 300 });
    panel.scrollTop = 0;

    appendEvent("e-up");

    expect(await screen.findByRole("button", { name: /Ver lo más reciente/ })).toBeInTheDocument();
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("scrolls to the bottom and hides the button when the jump button is clicked", async () => {
    renderPanel();
    const panel = screen.getByRole("tabpanel");
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;
    Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(panel, "clientHeight", { configurable: true, value: 300 });
    panel.scrollTop = 0;

    appendEvent("e-up2");
    const jump = await screen.findByRole("button", { name: /Ver lo más reciente/ });

    fireEvent.click(jump);
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Ver lo más reciente/ })).not.toBeInTheDocument());
  });
});

describe("ConversationPanel — 'pensando' state (spec P3/S3)", () => {
  it("shows a thinking indicator after send, then replaces it with the new reply once turn_id changes", async () => {
    server.use(evolvingLastReplyHandler({ turn_id: 1 }, { text: "che, buenísimo el clip", turn_id: 2 }, 1));
    renderPanel();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument()); // let the initial GET land

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByText(/pensando/i)).toBeInTheDocument());

    await waitFor(() => expect(screen.getByText("che, buenísimo el clip")).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByText(/pensando/i)).not.toBeInTheDocument();
  });

  it("keeps showing the thinking indicator when the reply query hasn't resolved yet at submit time (FIX-F4)", async () => {
    server.use(evolvingLastReplyHandler({ turn_id: 0 }, { text: "ya volvió", turn_id: 5 }, 2));
    renderPanel();

    // Submit immediately — no await before this, so GET /api/chat/last-reply
    // has not resolved yet and currentTurnId is still null at submit time.
    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByText(/pensando/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("ya volvió")).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByText(/pensando/i)).not.toBeInTheDocument();
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

describe("ConversationPanel transcript accumulation (WU-F)", () => {
  it("appends each new Kira reply instead of replacing the previous one, and dedupes refetches of the same turn_id", async () => {
    server.use(
      evolvingLastReplyHandler({ text: "primera respuesta", turn_id: 1 }, { text: "segunda respuesta", turn_id: 2 }, 1)
    );
    renderPanel();

    await screen.findByText("primera respuesta");
    await waitFor(() => expect(screen.getByText("segunda respuesta")).toBeInTheDocument(), { timeout: 4000 });
    // The first reply must STILL be visible — this is the actual bug: the
    // old implementation replaced it instead of appending.
    expect(screen.getByText("primera respuesta")).toBeInTheDocument();

    // A poll refetch that keeps returning the SAME (already-recorded) turn_id
    // must not append a duplicate entry.
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect(screen.getAllByText("segunda respuesta")).toHaveLength(1);
  });

  it("does not render a phantom Kira turn before the first reply lands (turn_id: 0, text: null)", async () => {
    renderPanel();
    await new Promise((resolve) => setTimeout(resolve, 1700)); // let a poll cycle elapse
    expect(screen.queryByText("KIRA")).not.toBeInTheDocument();
  });

  it("resyncs without appending when turn_id regresses (backend restart resets the counter), then appends normally once a genuinely new turn_id lands", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/chat/last-reply`, () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ text: "reply five", turn_id: 5 });
        // Backend restarted — its turn_id counter reset to 1, and the reply
        // it serves is stale from the new process's perspective.
        if (calls === 2) return HttpResponse.json({ text: "stale reply one", turn_id: 1 });
        return HttpResponse.json({ text: "reply two", turn_id: 2 });
      })
    );
    renderPanel();

    await screen.findByText("reply five");

    // The regression (turn_id 1 < 5) must resync silently — no new bubble,
    // no duplicate key.
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(screen.queryByText("stale reply one")).not.toBeInTheDocument();

    // A genuinely new turn_id relative to the new (post-restart) baseline
    // appends exactly once.
    await waitFor(() => expect(screen.getByText("reply two")).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getAllByText("reply two")).toHaveLength(1);
    expect(screen.getByText("reply five")).toBeInTheDocument();
  });

  it("keeps every operator message visible across multiple sends (they must not be replaced either)", async () => {
    renderPanel();
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "primer mensaje" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(input.value).toBe(""));

    fireEvent.change(input, { target: { value: "segundo mensaje" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(input.value).toBe(""));

    expect(screen.getByText("primer mensaje")).toBeInTheDocument();
    expect(screen.getByText("segundo mensaje")).toBeInTheDocument();
  });
});

describe("ConversationPanel — agenda events in chat (WU4)", () => {
  it("renders an agenda divider line when a topic activates on the poll", async () => {
    // First snapshot seeds the baseline (no active topic); the second poll
    // activates a topic, which useAgendaEvents diffs into a "turno" event.
    const before: typeof defaultAgenda = { ...defaultAgenda, active_topic: null };
    const after: typeof defaultAgenda = {
      ...defaultAgenda,
      active_topic: { ...defaultAgenda.active_topic!, turns_spoken: 1 }
    };
    server.use(evolvingAgendaHandler(before, after, 1));
    renderPanel();

    await waitFor(() => expect(screen.getByText(/turno 1 · tema: Mods como cultura popular en gaming/)).toBeInTheDocument(), {
      timeout: 4000
    });
    // It renders as an alert divider — visible in the Alertas tab, hidden in Chat.
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.queryByText(/turno 1 · tema/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Alertas" }));
    expect(screen.getByText(/turno 1 · tema/)).toBeInTheDocument();
  });

  it("tags a Kira reply from an autonomous agenda turn distinctly from a chat reply", async () => {
    server.use(lastReplyHandler({ text: "arranco con el tema de mods", source: "kira-agenda-topic-now", turn_id: 3 }));
    renderPanel();

    expect(await screen.findByText("arranco con el tema de mods")).toBeInTheDocument();
    // The agenda-sourced reply carries a distinct label, not the plain "KIRA".
    expect(screen.getByText("KIRA · AGENDA")).toBeInTheDocument();
    expect(screen.queryByText("KIRA")).not.toBeInTheDocument();
  });
});

describe("ConversationPanel — operator-action events (Item A event engine)", () => {
  it("renders an injected app event as a divider, visible in Todo and Alertas, absent from Chat", () => {
    act(() => {
      useEventStore.getState().append({ id: "e1", ts: Date.now(), source: "model", label: "Modelo → qwen3:8b", tone: "ok" });
    });
    renderPanel();

    expect(screen.getByText("Modelo → qwen3:8b")).toBeInTheDocument(); // Todo (default tab)

    fireEvent.click(screen.getByRole("tab", { name: "Alertas" }));
    expect(screen.getByText("Modelo → qwen3:8b")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.queryByText("Modelo → qwen3:8b")).not.toBeInTheDocument();
  });

  it("renders an app event line as a full-width Alert carrying its tone, with role=status (never interrupts)", () => {
    act(() => {
      useEventStore.getState().append({ id: "e-al", ts: Date.now(), source: "model", label: "Modelo → qwen3:8b", tone: "ok" });
    });
    renderPanel();

    const alert = screen.getByText("Modelo → qwen3:8b").closest(".oc-alert");
    expect(alert).not.toBeNull();
    // It follows the settings-driven alert style (oc-alert) and keeps its tone…
    expect(alert).toHaveAttribute("data-tone", "ok");
    // …but as a NON-interrupting status role — only live send-errors are role=alert.
    expect(alert).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("defaults an agenda event line (no tone) to a neutral status Alert", async () => {
    const before: typeof defaultAgenda = { ...defaultAgenda, active_topic: null };
    const after: typeof defaultAgenda = {
      ...defaultAgenda,
      active_topic: { ...defaultAgenda.active_topic!, turns_spoken: 1 }
    };
    server.use(evolvingAgendaHandler(before, after, 1));
    renderPanel();

    const line = await screen.findByText(/turno 1 · tema:/, undefined, { timeout: 4000 });
    const alert = line.closest(".oc-alert");
    expect(alert).toHaveAttribute("data-tone", "neutral");
    expect(alert).toHaveAttribute("role", "status");
  });

  it("interleaves an app event between transcript turns by ts, in document order", async () => {
    renderPanel();
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "primer mensaje" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(input.value).toBe(""));

    act(() => {
      useEventStore.getState().append({ id: "e-mid", ts: Date.now(), source: "obs", label: "OBS activado", tone: "ok" });
    });

    fireEvent.change(input, { target: { value: "segundo mensaje" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(input.value).toBe(""));

    const panel = screen.getByRole("tabpanel");
    const text = panel.textContent ?? "";
    expect(text.indexOf("primer mensaje")).toBeLessThan(text.indexOf("OBS activado"));
    expect(text.indexOf("OBS activado")).toBeLessThan(text.indexOf("segundo mensaje"));
  });
});

describe("ConversationPanel — markdown only on Kira turns", () => {
  it("renders **bold** in a Kira reply as a <strong>", async () => {
    server.use(lastReplyHandler({ text: "che, mirá **esto**", turn_id: 1 }));
    renderPanel();
    const strong = await screen.findByText("esto");
    expect(strong.tagName).toBe("STRONG");
  });

  it("keeps operator ('Vos') turns as literal text — **asterisks** are not markdown", async () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), {
      target: { value: "**test**" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    const bubble = await screen.findByText("**test**");
    expect(bubble.querySelector("strong")).toBeNull();
  });
});

describe("ConversationPanel — voice transcript echo (transcript-echo follow-up)", () => {
  it("appends ONE operator turn with the spoken text and a 'Vos · voz' label above the bubble", () => {
    renderPanel();
    expect(liveTranscriptCb).not.toBeNull(); // panel wired the echo hook

    act(() => liveTranscriptCb?.("hola kira como andás"));

    expect(screen.getAllByText("hola kira como andás")).toHaveLength(1);
    expect(screen.getByText("Vos · voz")).toBeInTheDocument();
    // A voice turn is a chat turn: the empty-state invitation must be gone.
    expect(screen.queryByText("Empezá a chatear con Kira")).not.toBeInTheDocument();
  });

  it("keeps typed turns labeled plain 'Vos' — the voice label never bleeds onto composer sends", async () => {
    renderPanel();
    act(() => liveTranscriptCb?.("turno de voz previo"));

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), {
      target: { value: "turno tipeado" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText("turno tipeado");

    expect(screen.getByText("Vos · voz")).toBeInTheDocument();
    expect(screen.getByText("Vos")).toBeInTheDocument(); // exact-match: the plain label exists separately
  });

  it("degraded path: no echo resolved -> timeline untouched, no crash, no alert spam", () => {
    renderPanel();
    // The hook (mocked to its contract) never fires — LiveAudio WS down.
    expect(screen.getByText("Empezá a chatear con Kira")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
