import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { useEventStore } from "../../store/eventStore.js";
import {
  API_BASE_URL,
  chatTurnConflictHandler,
  chatTurnNetworkErrorHandler,
  chatTurnQueueFullHandler,
  chatTurnValidationHandler,
  defaultAgenda,
  evolvingAgendaHandler,
  evolvingLastReplyHandler,
  frozenStatusHandler,
  lastReplyHandler,
  pttSessionFlowHandlers,
  pttStartUnreachableHandler
} from "../../test/handlers.js";
import { useLogsPrefStore } from "../../store/useLogsPref.js";
import { ConversationPanel, TRANSCRIPT_CAP } from "./ConversationPanel.js";

// The LiveAudio WS echo hook is unit-tested in src/api/liveTranscript.test.ts;
// here it's mocked down to its contract — "fires the callback with the final
// spoken text at most once per hold" — so panel tests drive the append/render
// path directly instead of re-mocking WebSocket + the state poll.
let liveTranscriptCb: ((text: string, pttStamp: number) => void) | null = null;
vi.mock("../../api/liveTranscript.js", () => ({
  useLiveTranscript: (cb: (text: string, pttStamp: number) => void) => {
    liveTranscriptCb = cb;
  }
}));

/** Fire the mocked echo for one hold. `pttStamp` is the hook's second contract
 * half: the server `ptt.*` reading that arrived while THAT hold was live, or 0
 * when the hold had none to borrow (see src/api/liveTranscript.test.ts). */
function echo(text: string, pttStamp = 0) {
  act(() => liveTranscriptCb?.(text, pttStamp));
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

// Owner layout correction (2026-07-18): ONE unified strip replaces the old
// stacked "Columna" (Chat|Comandos|Logs) + "Filtro de conversación"
// (Todo|Chat|Alertas) pair. Todo/Chat/Alertas are feed filters over the ONE
// timeline (id "conversation-panel"); Comandos/Logs swap the panel.
const timeline = () => document.getElementById("conversation-panel") as HTMLElement;
const strip = () => screen.getByRole("tablist", { name: "Conversación" });
const tab = (name: string | RegExp) => within(strip()).getByRole("tab", { name });

beforeEach(() => {
  useEventStore.setState({ events: [] });
  // The Logs-tab preference is a module singleton — default OFF, reset per test.
  useLogsPrefStore.setState({ showLogs: false });
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
    const chatTab = tab("Chat");
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
    const chatTab = tab("Chat");
    const alertasTab = tab("Alertas");

    // Todo (default): both a chat turn and the alert-kind divider are visible.
    const todoPanel = timeline();
    expect(todoPanel).toHaveTextContent(/todo bien por acá/);
    expect(todoPanel).toHaveTextContent(/Modelo → qwen3:8b/);

    fireEvent.click(chatTab);
    const chatPanel = timeline();
    expect(chatTab).toHaveAttribute("aria-controls", chatPanel.id);
    expect(chatPanel).toHaveAttribute("aria-labelledby", chatTab.id);
    expect(chatPanel).toHaveTextContent(/todo bien por acá/);
    expect(chatPanel).not.toHaveTextContent(/Modelo → qwen3:8b/);

    fireEvent.click(alertasTab);
    const alertasPanel = timeline();
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
    fireEvent.click(tab("Alertas"));
    expect(screen.getByText("Sin turnos en este filtro.")).toBeInTheDocument();
    expect(screen.queryByText("Empezá a chatear con Kira")).not.toBeInTheDocument();
  });

  it("anchors the viewers-muted banner exactly once, outside the scrollable timeline", () => {
    renderPanel();
    expect(screen.getAllByText("Chat de viewers silenciado")).toHaveLength(1);
    // The banner lives above the composer, not inside the scroll region.
    expect(timeline()).not.toHaveTextContent(/Chat de viewers silenciado/);
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
    const panel = timeline();
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
    const panel = timeline();
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
    const panel = timeline();
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
    const panel = timeline();
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

  // The transient "pensando" row is appended AFTER the sorted list and stays
  // there for the WHOLE in-flight window — tens of seconds on a heavy local
  // model (OLLAMA_CHAT_TIMEOUT is 180s). Anything that lands during it (agenda
  // lifecycle line, memoria_captured on the events poll, a PTT voice echo) must
  // still follow the stream instead of piling up below the viewport.
  it("follows an append that lands while the 'pensando' indicator is on screen", async () => {
    renderPanel();
    const panel = timeline();
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText(/pensando/i);
    scrollSpy.mockClear(); // the operator's own bubble already followed

    appendEvent("e-mid-thinking");

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
  });

  // At TRANSCRIPT_CAP every arrival evicts one turn, so the row count can never
  // grow again. Auto-scroll must not die for the rest of the session.
  it("still follows an append once the transcript sits at TRANSCRIPT_CAP", async () => {
    renderPanel();
    const panel = timeline();
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;
    expect(liveTranscriptCb).not.toBeNull();

    act(() => {
      for (let i = 1; i <= TRANSCRIPT_CAP; i++) liveTranscriptCb?.(`turno de relleno ${i}`, 0);
    });
    scrollSpy.mockClear();

    echo("turno pasado el tope");

    await screen.findByText("turno pasado el tope");
    expect(scrollSpy).toHaveBeenCalled();
  });

  // The commonest append of all: Kira's reply REPLACES the thinking row, so the
  // row count goes 2 -> 2 in a single batched flush. The reply bubble is far
  // taller than the placeholder it replaces, so an operator sitting at the
  // bottom is left behind unless this follows.
  it("follows Kira's reply even though it replaces the thinking row (row count unchanged)", async () => {
    server.use(evolvingLastReplyHandler({ turn_id: 1 }, { text: "respuesta que reemplaza el placeholder", turn_id: 2 }, 1));
    renderPanel();
    const panel = timeline();
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText(/pensando/i);
    scrollSpy.mockClear();

    await screen.findByText("respuesta que reemplaza el placeholder", undefined, { timeout: 4000 });
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
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

describe("ConversationPanel — D3b bounded-wait receipt + F12 provider disclosure (runtime_findings_batch_20260731)", () => {
  it("shows the D3b receipt instead of the generic 'pensando' copy while the engine is busy", async () => {
    // is_speaking=true mirrors an agenda block currently playing — D3: direct
    // chat never interrupts, it answers on the next turn boundary.
    server.use(frozenStatusHandler(1, { is_speaking: true }));
    server.use(evolvingLastReplyHandler({ turn_id: 1 }, { text: "ya te contesto", turn_id: 2 }, 1));
    renderPanel();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() =>
      expect(screen.getByText("Kira te escuchó — responderá después del bloque actual")).toBeInTheDocument()
    );
    expect(screen.queryByText(/^Kira está pensando/)).not.toBeInTheDocument();
  });

  it("keeps the generic 'pensando' copy while the engine is idle (no queueing involved)", async () => {
    server.use(frozenStatusHandler(1, { is_speaking: false, is_processing: false }));
    server.use(evolvingLastReplyHandler({ turn_id: 1 }, { text: "listo", turn_id: 2 }, 1));
    renderPanel();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByText(/pensando/i)).toBeInTheDocument());
    expect(
      screen.queryByText("Kira te escuchó — responderá después del bloque actual")
    ).not.toBeInTheDocument();
  });

  it("surfaces queue_wait_ms and the answering provider on the landed reply", async () => {
    server.use(
      lastReplyHandler({
        text: "todo tranquilo por acá",
        turn_id: 1,
        queue_wait_ms: 42000,
        answered_by_provider: "local"
      })
    );
    renderPanel();

    await screen.findByText("todo tranquilo por acá");
    expect(screen.getByText("esperó 42 s en cola · Ollama local")).toBeInTheDocument();
  });

  it("discloses a provider change while queued (F12)", async () => {
    server.use(
      lastReplyHandler({
        text: "che, perdón la demora",
        turn_id: 1,
        queue_wait_ms: 5000,
        answered_by_provider: "local",
        submitted_under_provider: "nvidia_nim",
        provider_changed_while_queued: true
      })
    );
    renderPanel();

    await screen.findByText("che, perdón la demora");
    expect(
      screen.getByText("esperó 5 s en cola · Ollama local (cambió de proveedor en cola)")
    ).toBeInTheDocument();
  });

  it("stays silent on the meta line for an untagged reply (agenda/accumulated — never a fabricated value)", async () => {
    server.use(lastReplyHandler({ text: "bloque de agenda", turn_id: 1, source: "kira-agenda" }));
    renderPanel();

    await screen.findByText("bloque de agenda");
    expect(screen.queryByText(/esperó/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ollama local/)).not.toBeInTheDocument();
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
    // activates a topic, which useAgendaEvents diffs into an "intento" event.
    const before: typeof defaultAgenda = { ...defaultAgenda, active_topic: null };
    const after: typeof defaultAgenda = {
      ...defaultAgenda,
      active_topic: { ...defaultAgenda.active_topic!, turns_spoken: 1 }
    };
    server.use(evolvingAgendaHandler(before, after, 1));
    renderPanel();

    await waitFor(() => expect(screen.getByText(/intento 1 · tema: Mods como cultura popular en gaming/)).toBeInTheDocument(), {
      timeout: 4000
    });
    // It renders as an alert divider — visible in the Alertas tab, hidden in Chat.
    fireEvent.click(tab("Chat"));
    expect(screen.queryByText(/intento 1 · tema/)).not.toBeInTheDocument();
    fireEvent.click(tab("Alertas"));
    expect(screen.getByText(/intento 1 · tema/)).toBeInTheDocument();
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

    fireEvent.click(tab("Alertas"));
    expect(screen.getByText("Modelo → qwen3:8b")).toBeInTheDocument();

    fireEvent.click(tab("Chat"));
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

    const line = await screen.findByText(/intento 1 · tema:/, undefined, { timeout: 4000 });
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

    const panel = timeline();
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

    echo("hola kira como andás");

    expect(screen.getAllByText("hola kira como andás")).toHaveLength(1);
    expect(screen.getByText("Vos · voz")).toBeInTheDocument();
    // A voice turn is a chat turn: the empty-state invitation must be gone.
    expect(screen.queryByText("Empezá a chatear con Kira")).not.toBeInTheDocument();
  });

  it("keeps typed turns labeled plain 'Vos' — the voice label never bleeds onto composer sends", async () => {
    renderPanel();
    echo("turno de voz previo");

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

describe("ConversationPanel — unified tab strip (owner layout correction 2026-07-18)", () => {
  it("renders ONE Todo|Chat|Comandos|Alertas strip; Todo is the default feed tab with composer + timeline", () => {
    renderPanel();
    // Exactly one tablist exists — the two-strip layout is gone.
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    for (const name of ["Todo", "Chat", "Comandos", "Alertas"]) {
      expect(tab(name)).toBeInTheDocument();
    }
    expect(tab("Todo")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByPlaceholderText("Escribí un mensaje para Kira…")).toBeInTheDocument();
  });

  it("shows the composer on every feed tab and hides it on Comandos and Logs (R8)", () => {
    useLogsPrefStore.getState().setShowLogs(true);
    renderPanel();
    const composer = () => screen.queryByPlaceholderText("Escribí un mensaje para Kira…");

    expect(composer()).toBeInTheDocument(); // Todo (default)
    fireEvent.click(tab("Chat"));
    expect(composer()).toBeInTheDocument();
    fireEvent.click(tab("Alertas"));
    expect(composer()).toBeInTheDocument();

    fireEvent.click(tab("Comandos"));
    expect(composer()).not.toBeInTheDocument();
    fireEvent.click(tab(/Logs/));
    expect(composer()).not.toBeInTheDocument();

    fireEvent.click(tab("Chat"));
    expect(composer()).toBeInTheDocument();
  });

  it("keeps the Chat timeline mounted across a tab switch (R6 — no remount)", () => {
    renderPanel();
    const before = timeline();
    // jsdom does no layout, so a literal scrollTop survival is unreliable; the
    // robust proxy is DOM node identity — a remount would swap the node.
    fireEvent.click(tab("Comandos"));
    fireEvent.click(tab("Todo"));
    expect(timeline()).toBe(before);
  });

  it("renders all 7 commands inline in the Comandos tab, with no floating dialog (R9)", () => {
    renderPanel();
    fireEvent.click(tab("Comandos"));

    const comandosPanel = screen.getByRole("tabpanel"); // only Comandos is visible now
    for (const badge of ["/agenda", "/perfil", "/temas", "/vivo", "/acciones", "/sesion", "/musica"]) {
      expect(within(comandosPanel).getByText(badge)).toBeInTheDocument();
    }
    // Inline, not a floating dialog, and not the launcher listbox (no composer).
    expect(screen.queryByRole("dialog", { name: "Comandos del chat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Comandos disponibles" })).not.toBeInTheDocument();
  });
});

describe("ConversationPanel — emergent command launcher (owner layout correction 2026-07-18)", () => {
  const launcher = () => screen.queryByRole("listbox", { name: "Comandos disponibles" });
  function typeComposer(value: string) {
    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value } });
  }

  it("stays hidden until the composer input starts with '/' or '!', and filters as you type", () => {
    renderPanel();
    expect(launcher()).not.toBeInTheDocument();
    typeComposer("hola");
    expect(launcher()).not.toBeInTheDocument();

    typeComposer("/ag");
    const options = within(launcher() as HTMLElement).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("/agenda");

    typeComposer("!se"); // bang prefix, same namespace
    expect(within(launcher() as HTMLElement).getByText("/sesion")).toBeInTheDocument();
  });

  it("ArrowDown + Enter selects a command, opens it in the Comandos tab, and closes the launcher (R8/R9)", () => {
    renderPanel();
    typeComposer("/"); // all 7, highlight on /agenda
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // → /perfil
    fireEvent.keyDown(input, { key: "Enter" });

    // Routed to the Comandos tab, with /perfil opened (its first step renders).
    expect(tab("Comandos")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("¿Cómo se llama el perfil?")).toBeInTheDocument();
    // Launcher and composer are both gone (composer hidden outside feed tabs).
    expect(launcher()).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Escribí un mensaje para Kira…")).not.toBeInTheDocument();
  });

  it("closes on Escape, clears the composer, and restores focus to the input", () => {
    renderPanel();
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…") as HTMLInputElement;
    input.focus();
    typeComposer("/ag");
    expect(launcher()).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(launcher()).not.toBeInTheDocument();
    expect(input.value).toBe("");
    expect(input).toHaveFocus();
  });

  it("Enter/arrows from another focused composer control (e.g. the mic button) do NOT navigate or select (F2)", () => {
    renderPanel();
    typeComposer("/"); // all 7, highlight on /agenda
    const mic = screen.getByRole("button", { name: "Mantené para hablar con Kira" });
    fireEvent.keyDown(mic, { key: "ArrowDown" });
    fireEvent.keyDown(mic, { key: "Enter" });

    // Launcher stays open, still highlighting the first option — nothing selected.
    expect(launcher()).toBeInTheDocument();
    expect(within(launcher() as HTMLElement).getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(tab("Comandos")).toHaveAttribute("aria-selected", "false");
  });

  it("composer input carries the combobox pattern — expanded/controls/activedescendant follow the highlight (F3)", () => {
    renderPanel();
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…");
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-expanded", "false");

    typeComposer("/"); // all 7, highlight on /agenda
    expect(input).toHaveAttribute("aria-expanded", "true");
    const listbox = launcher() as HTMLElement;
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-opt-agenda");

    fireEvent.keyDown(input, { key: "ArrowDown" }); // → /perfil
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-opt-perfil");
  });

  it("zero-match state collapses the combobox contract — no listbox, no controls/activedescendant, hint stays visible (F1)", () => {
    renderPanel();
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…");
    typeComposer("/xyz");

    expect(launcher()).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-controls");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    // The unknown-command hint stays visible as a plain status element, not an option.
    expect(screen.getByText("comando desconocido")).toHaveAttribute("role", "status");
  });

  it("activedescendant always references a currently-listed option while the filter narrows, even right after ArrowDown (F2)", () => {
    renderPanel();
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…");

    typeComposer("/a"); // /agenda, /acciones
    fireEvent.keyDown(input, { key: "ArrowDown" }); // highlight → /acciones (2nd match)
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-opt-acciones");

    typeComposer("/ac"); // narrows to /acciones only — the highlighted option survives
    let ids = within(launcher() as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.id);
    expect(ids).toContain(input.getAttribute("aria-activedescendant"));

    typeComposer("/acc"); // still narrowed to /acciones only
    ids = within(launcher() as HTMLElement)
      .getAllByRole("option")
      .map((option) => option.id);
    expect(ids).toContain(input.getAttribute("aria-activedescendant"));

    typeComposer("/xyz"); // narrows to zero matches — no listbox, no activedescendant
    expect(launcher()).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("closes when the operator clears the input back to plain text", () => {
    renderPanel();
    typeComposer("/ag");
    expect(launcher()).toBeInTheDocument();
    typeComposer("");
    expect(launcher()).not.toBeInTheDocument();
  });

  it("never sends a '/'-prefixed command as a chat turn on Enter", async () => {
    let chatPosts = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, () => {
        chatPosts += 1;
        return HttpResponse.json({ accepted: true, command_id: "c", status: "queued", state_version: 2 });
      })
    );
    renderPanel();
    typeComposer("/xyz"); // unknown → Enter is inert, no select, no chat send
    fireEvent.submit(screen.getByPlaceholderText("Escribí un mensaje para Kira…").closest("form") as HTMLFormElement);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(chatPosts).toBe(0);
  });
});

describe("ConversationPanel — Logs tab (WU6: R7/R10/R32/R36)", () => {
  it("hides the Logs tab when the Mostrar logs preference is OFF (default) (R36)", () => {
    renderPanel();
    expect(tab("Chat")).toBeInTheDocument();
    expect(tab("Comandos")).toBeInTheDocument();
    expect(within(strip()).queryByRole("tab", { name: /Logs/ })).not.toBeInTheDocument();
  });

  it("shows the Logs tab and renders real LogsPanel content when the preference is ON (R36/R10)", () => {
    useLogsPrefStore.getState().setShowLogs(true);
    act(() => {
      useEventStore.getState().append({ id: "e-log", ts: Date.now(), source: "model", label: "Modelo → qwen3:8b", tone: "ok" });
    });
    renderPanel();

    fireEvent.click(tab(/Logs/));
    const logsPanel = screen.getByRole("tabpanel"); // only Logs is visible now
    expect(within(logsPanel).getByText("Modelo → qwen3:8b")).toBeInTheDocument();
    expect(within(logsPanel).getByText("model")).toBeInTheDocument();
  });

  it("lights the Logs unread dot when an event lands on Chat, and clears it once viewed (R7)", () => {
    useLogsPrefStore.getState().setShowLogs(true);
    renderPanel();
    // Default column is Chat; a new engine event lands.
    act(() => {
      useEventStore.getState().append({ id: "e-unread", ts: Date.now(), source: "model", label: "Motor: listo", tone: "info" });
    });
    expect(tab(/Logs/).querySelector("[data-unread]")).not.toBeNull();

    // Switching to Logs and rendering the entry clears the indicator.
    fireEvent.click(tab(/Logs/));
    expect(tab(/Logs/).querySelector("[data-unread]")).toBeNull();
  });

  it("never lights the Logs unread dot for an event that lands while already on Logs (R7)", () => {
    useLogsPrefStore.getState().setShowLogs(true);
    renderPanel();
    fireEvent.click(tab(/Logs/)); // already viewing Logs

    act(() => {
      useEventStore.getState().append({ id: "e-on-logs", ts: Date.now(), source: "model", label: "Motor: listo", tone: "info" });
    });
    expect(tab(/Logs/).querySelector("[data-unread]")).toBeNull();
  });
});

/**
 * Feed ordering (owner-reproduced 2026-07-24, PRE-DATES the background-polling
 * fix). Every channel used to stamp its own CLIENT ARRIVAL time, so events from
 * four independent polls were sorted against each other by whenever the webview
 * happened to observe them. With the window backgrounded, Kira's reply rendered
 * ABOVE the operator turn that caused it.
 *
 * Two of the four channels DO have a real server clock available and were
 * throwing it away: GET /api/chat/last-reply carries `ts` (ChatReplySink.record,
 * opencohost/api/engine_host.py) and GET /api/events carries the engine's own
 * `ptt.*` echo with its server ts (src/api/events.ts). The spoken WORDS never
 * cross the HTTP API by privacy design, so the PTT echo's stamp is the closest
 * honest reading the voice channel can get.
 */
describe("ConversationPanel — feed ordering by real timestamps", () => {
  const MINUTE = 60_000;

  function appendEvent(id: string, ts: number, label: string, source: "model" | "obs" | "ptt" = "model") {
    act(() => {
      useEventStore.getState().append({ id, ts, source, label, tone: "ok" });
    });
  }

  function order(...needles: string[]): number[] {
    const text = timeline().textContent ?? "";
    return needles.map((needle) => {
      const at = text.indexOf(needle);
      expect(at).toBeGreaterThanOrEqual(0); // guards a silent -1 vs -1 comparison
      return at;
    });
  }

  it("sorts Kira's reply by the SERVER ts it already carries, not by client arrival time", async () => {
    const now = Date.now();
    // The reply was generated an hour ago and is only polled NOW (backgrounded
    // window / one catch-up burst). Arrival time would sort it below the event
    // stamped 30 minutes ago; its own server ts must not.
    server.use(lastReplyHandler({ text: "respuesta generada hace una hora", turn_id: 1, ts: (now - 60 * MINUTE) / 1000 }));
    appendEvent("e-30m", now - 30 * MINUTE, "Modelo → qwen3:8b");
    renderPanel();
    await screen.findByText("respuesta generada hace una hora");

    const [reply, event] = order("respuesta generada hace una hora", "Modelo → qwen3:8b");
    expect(reply).toBeLessThan(event);
  });

  it("falls back to arrival time when the reply carries no server ts (older backend, ts: null)", async () => {
    const now = Date.now();
    server.use(lastReplyHandler({ text: "respuesta sin sello", turn_id: 1, ts: null }));
    appendEvent("e-1h", now - 60 * MINUTE, "Modelo → qwen3:8b");
    renderPanel();
    await screen.findByText("respuesta sin sello");

    const [event, reply] = order("Modelo → qwen3:8b", "respuesta sin sello");
    expect(event).toBeLessThan(reply);
  });

  it("keeps a voice turn ABOVE the reply it caused when both channels are observed late in one burst", async () => {
    const now = Date.now();
    // The engine's PTT echo is the voice channel's only server clock reading:
    // release at -10m, reply dispatched after the grace window at -9m. The
    // transcript itself resolves NOW, ten minutes after the words were spoken.
    appendEvent("srv-7", now - 10 * MINUTE, "PTT enviado a Kira", "ptt");
    server.use(lastReplyHandler({ text: "sobre el benchmark de AGI", turn_id: 1, ts: (now - 9 * MINUTE) / 1000 }));
    renderPanel();
    await screen.findByText("sobre el benchmark de AGI");

    // `ptt.stopped` is emitted at release, i.e. while the hook still counts the
    // hold as active (flushing) — so it IS this hold's own reading and the hook
    // hands it over.
    echo("qué opinás del benchmark de AGI", now - 10 * MINUTE);

    const [spoken, reply] = order("qué opinás del benchmark de AGI", "sobre el benchmark de AGI");
    expect(spoken).toBeLessThan(reply);
  });

  // Judge scenario 1 (stale borrow across two holds). Server order:
  // started(h1)@-10m, stopped(h1)@-9m30s, reply-to-h1@-9m, started(h2)@-8m.
  // Hold 1's echo fires with only started(h1) ingested; by hold 2's rising edge
  // the newest ptt row is stopped(h1), which is therefore hold 2's BASELINE, so
  // the hook hands hold 2 nothing (0). A running maximum instead handed over
  // stopped(h1)@-9m30s — earlier than the reply already in the feed, so the
  // second spoken question rendered ABOVE the answer to the first.
  it("never stamps a second voice turn with the PREVIOUS hold's reading", async () => {
    const now = Date.now();
    appendEvent("srv-started-h1", now - 10 * MINUTE, "PTT escuchando", "ptt");
    server.use(lastReplyHandler({ text: "respuesta al primer turno", turn_id: 1, ts: (now - 9 * MINUTE) / 1000 }));
    renderPanel();
    await screen.findByText("respuesta al primer turno");

    echo("primer turno de voz", now - 10 * MINUTE);
    appendEvent("srv-stopped-h1", now - 9.5 * MINUTE, "PTT enviado a Kira", "ptt");
    echo("segundo turno de voz"); // hold 2: nothing arrived while it was live

    const [first, reply, second] = order("primer turno de voz", "respuesta al primer turno", "segundo turno de voz");
    expect(first).toBeLessThan(reply);
    expect(reply).toBeLessThan(second);
  });

  // Judge scenario 2 (zero-baseline hold). Hold 1's echo fires before ANY ptt row
  // has been polled, so it takes arrival time — and the running maximum's ref
  // stayed at 0, which let hold 2 borrow a ten-minute-old stopped(h1) and sort
  // far above both the reply AND hold 1's own bubble.
  it("never lets a hold that got no reading of its own be outranked by a stale one", async () => {
    const now = Date.now();
    server.use(lastReplyHandler({ text: "respuesta al primer turno", turn_id: 1, ts: (now - 9 * MINUTE) / 1000 }));
    renderPanel();
    await screen.findByText("respuesta al primer turno");

    echo("primer turno de voz"); // nothing polled yet -> arrival time
    appendEvent("srv-stopped-h1", now - 10 * MINUTE, "PTT enviado a Kira", "ptt");
    echo("segundo turno de voz"); // stale row is hold 2's baseline, not its stamp

    const [reply, first, second] = order("respuesta al primer turno", "primer turno de voz", "segundo turno de voz");
    expect(reply).toBeLessThan(first);
    expect(reply).toBeLessThan(second);
    // Both fall back to arrival time and can land in the same millisecond; Array
    // sort is stable (ES2019), so append order decides and hold 1 stays first.
    expect(first).toBeLessThan(second);
  });

  it("does not force-scroll when a backfilled event sorts into the MIDDLE of the list", async () => {
    const now = Date.now();
    renderPanel();
    const panel = timeline();
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;
    // jsdom reports zero geometry, i.e. "near the bottom": an append that lands
    // LAST does follow. Asserted first so the spy is proven live.
    appendEvent("e-last", now, "Modelo → qwen3:8b");
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    // Stamped a minute earlier -> sorts ABOVE e-last. The count grows, but
    // nothing new is at the bottom, so the operator must not be yanked there.
    appendEvent("e-backfill", now - MINUTE, "OBS activado", "obs");
    await screen.findByText("OBS activado");
    const [backfill, last] = order("OBS activado", "Modelo → qwen3:8b");
    expect(backfill).toBeLessThan(last);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  // Same backfill, but with REAL scrolled-up geometry so the jump-pill branch is
  // actually reachable: under zero jsdom geometry every append reads as "near the
  // bottom" and a no-pill assertion cannot fail. Nothing arrived at the bottom,
  // so neither half of the effect may fire.
  it("never lights the jump pill for a backfilled event when the operator is scrolled up", async () => {
    const now = Date.now();
    renderPanel();
    const panel = timeline();
    const scrollSpy = vi.fn();
    panel.scrollTo = scrollSpy as unknown as typeof panel.scrollTo;

    appendEvent("e-anchor", now, "Modelo → qwen3:8b"); // zero geometry: follows, no pill
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));

    // distance from bottom = 1000 - 0 - 300 = 700 > NEAR_BOTTOM_PX.
    Object.defineProperty(panel, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(panel, "clientHeight", { configurable: true, value: 300 });
    panel.scrollTop = 0;

    appendEvent("e-backfill-up", now - MINUTE, "OBS activado", "obs");
    await screen.findByText("OBS activado");
    expect(screen.queryByRole("button", { name: /Ver lo más reciente/ })).not.toBeInTheDocument();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("stamps every row with its own quiet wall-clock time", async () => {
    const at = new Date(2026, 6, 24, 18, 5, 0).getTime();
    server.use(lastReplyHandler({ text: "respuesta con hora", turn_id: 1, ts: at / 1000 }));
    appendEvent("e-hora", at, "Modelo → qwen3:8b");
    renderPanel();
    await screen.findByText("respuesta con hora");

    echo("turno de voz con hora");

    // Three row shapes: Kira bubble, operator bubble, alert line.
    const stamps = Array.from(timeline().querySelectorAll("time"));
    expect(stamps).toHaveLength(3);
    const expected = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(at);
    expect(stamps.map((node) => node.textContent)).toContain(expected);
    expect(stamps[0]).toHaveAttribute("datetime", new Date(at).toISOString());
  });
});

/**
 * Progressive-slowdown guard (2026-07-24). The session transcript was the
 * largest of the three streams feeding this timeline and the only one with no
 * bound at all: `eventStore` already capped itself at EVENT_CAP=200, and agenda
 * events now cap at AGENDA_EVENT_CAP, but operator/Kira/voice turns accumulated
 * for the entire stream. Every turn is re-mapped, re-sorted and re-filtered on
 * every render — and renders are driven by four independent polls — so an
 * unbounded transcript makes the whole cockpit get slower the longer a stream
 * runs. Same ring-buffer contract as eventStore: bounded, oldest-first eviction.
 */
describe("ConversationPanel transcript ring buffer (progressive-slowdown guard)", () => {
  it("holds at TRANSCRIPT_CAP under a flood of appends, keeping the newest turns", async () => {
    renderPanel();
    await screen.findByRole("tab", { name: "Todo" });
    expect(liveTranscriptCb).not.toBeNull();

    const flood = TRANSCRIPT_CAP + 40;
    act(() => {
      for (let i = 1; i <= flood; i++) {
        // Voice echo is the cheapest real append path into `transcript`; the
        // composer and Kira-reply paths push into the same state.
        liveTranscriptCb?.(`flood turno numero ${i}`, 0);
      }
    });

    const rendered = screen.getAllByText(/^flood turno numero \d+$/);
    expect(rendered).toHaveLength(TRANSCRIPT_CAP);
    // Oldest-first eviction: turn 1 is gone, the newest turn survived, and the
    // retained window is exactly the last CAP appends in order.
    expect(screen.queryByText("flood turno numero 1")).not.toBeInTheDocument();
    expect(screen.getByText(`flood turno numero ${flood}`)).toBeInTheDocument();
    expect(rendered[0]).toHaveTextContent(`flood turno numero ${flood - TRANSCRIPT_CAP + 1}`);
    expect(rendered[rendered.length - 1]).toHaveTextContent(`flood turno numero ${flood}`);
  });
});
