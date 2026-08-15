import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  defaultPttStart,
  defaultPttState,
  evolvingLastReplyHandler,
  pttConfigValidationErrorHandler,
  pttSessionFlowHandlers,
  pttStartUnreachableHandler,
  pttStateHandler,
  pttTestHandler
} from "../../test/handlers.js";
import { PTTCard } from "./PTTCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PTTCard)));
}

function holdButton() {
  return screen.getByRole("button", { name: "Mantené para hablar" });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PTTCard: idle defaults", () => {
  it("renders idle with the hold button and the desktop-only hotkey note", async () => {
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(holdButton()).toBeInTheDocument();
    expect(screen.getByText("PTT · Push-to-Talk")).toBeInTheDocument();
    const mapButton = screen.getByRole("button", { name: "Mapear atajo" });
    expect(mapButton).toBeDisabled();
    // Named, not "the only role=status in the card" — the LiveAudio section
    // carries its own note now, and this one is about the hotkey.
    expect(screen.getByText(/Mapear atajo requiere la app de escritorio/)).toBeInTheDocument();
  });
});

describe("PTTCard: pointer hold", () => {
  it("pointerdown starts (shows Escuchando… only after the 200); pointerup stops and converges to idle", async () => {
    server.use(...pttSessionFlowHandlers(2));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.pointerDown(holdButton(), { pointerId: 1 });
    // Not optimistic — still not "Escuchando…" the instant pointerdown fires.
    expect(screen.queryByRole("button", { name: "Escuchando…" })).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "Escuchando…" })).toBeInTheDocument();

    fireEvent.pointerUp(screen.getByRole("button", { name: "Escuchando…" }), { pointerId: 1 });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "Procesando…" })).toBeInTheDocument();

    // Exact ~2s poll-transition mechanics are already covered at the hook
    // level (src/api/ptt.test.ts) — this only proves the UI wiring reacts.
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(holdButton()).toBeInTheDocument();
  });

  it("pointercancel also stops the hold", async () => {
    server.use(...pttSessionFlowHandlers(2));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.pointerDown(holdButton(), { pointerId: 1 });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "Escuchando…" })).toBeInTheDocument();

    fireEvent.pointerCancel(screen.getByRole("button", { name: "Escuchando…" }), { pointerId: 1 });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "Procesando…" })).toBeInTheDocument();
  });
});

describe("PTTCard: keyboard hold", () => {
  it("Space keydown starts, keyup stops — from anywhere in the window", async () => {
    server.use(...pttSessionFlowHandlers(2));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.keyDown(window, { code: "Space" });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "Escuchando…" })).toBeInTheDocument();

    fireEvent.keyUp(window, { code: "Space" });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "Procesando…" })).toBeInTheDocument();
  });

  it("ignores OS key-repeat — a held key does not re-trigger start()", async () => {
    let startCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/ptt/start`, () => {
        startCalls += 1;
        return HttpResponse.json(defaultPttStart);
      })
    );
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.keyDown(window, { code: "Space" });
    fireEvent.keyDown(window, { code: "Space", repeat: true });
    fireEvent.keyDown(window, { code: "Space", repeat: true });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(startCalls).toBe(1);
  });

  it("does not hijack Space/Enter while typing in a text field elsewhere", async () => {
    let startCalls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/ptt/start`, () => {
        startCalls += 1;
        return HttpResponse.json(defaultPttStart);
      })
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement("input", { "aria-label": "some other field" }),
        React.createElement(PTTCard)
      )
    );
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.keyDown(screen.getByLabelText("some other field"), { code: "Space" });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(startCalls).toBe(0);
    expect(holdButton()).toBeInTheDocument();
  });

  it("window blur while holding stops the session (alt-tab safety)", async () => {
    server.use(...pttSessionFlowHandlers(2));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.keyDown(window, { code: "Space" });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "Escuchando…" })).toBeInTheDocument();

    fireEvent(window, new Event("blur"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("button", { name: "Procesando…" })).toBeInTheDocument();
  });
});

describe("PTTCard: honest error state", () => {
  it("503 stt_unreachable renders the inline status note and NEVER a fake listening state", async () => {
    server.use(pttStartUnreachableHandler());
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.pointerDown(holdButton(), { pointerId: 1 });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.queryByRole("button", { name: "Escuchando…" })).not.toBeInTheDocument();
    expect(holdButton()).toBeInTheDocument();
    expect(screen.getByText(/STT \(WhisperLive\) no disponible/)).toBeInTheDocument();
  });
});

describe("PTTCard: reply arrives via the existing last-reply poll", () => {
  // Real timers, not fake: this is the one assertion in the file that needs
  // a SECOND poll to resolve with DIFFERENT data than the first. Under fake
  // timers, React's scheduler (MessageChannel-based, not a `setTimeout`)
  // schedules the resulting re-render on a channel `vi.advanceTimersByTimeAsync`
  // cannot drive, so the update never reaches this component — a test-harness
  // gotcha, not a product bug (verified: the query cache itself updates
  // correctly; only the component's re-render is what stalls under fake
  // timers). Every other test in this file only needs ONE resolved poll, so
  // fake timers + advanceTimersByTimeAsync work fine there.
  it(
    "shows 'Kira respondió.' once a NEW turn_id lands after our flush completes",
    async () => {
      vi.useRealTimers();
      server.use(
        ...pttSessionFlowHandlers(1),
        evolvingLastReplyHandler(
          { text: null, source: null, turn_id: 0, ts: null },
          { text: "todo piola", source: "llm", turn_id: 1, ts: 1000 },
          1
        )
      );
      renderCard();
      await waitFor(() => expect(holdButton()).toBeInTheDocument());

      fireEvent.pointerDown(holdButton(), { pointerId: 1 });
      await waitFor(() => expect(screen.getByRole("button", { name: "Escuchando…" })).toBeInTheDocument());
      fireEvent.pointerUp(screen.getByRole("button", { name: "Escuchando…" }), { pointerId: 1 });

      await waitFor(() => expect(screen.getByText("Kira respondió.")).toBeInTheDocument(), { timeout: 8000 });
    },
    10000
  );
});

describe("PTTCard: LiveAudio (WhisperLive) URL configuration", () => {
  it("tells the owner LiveAudio is a separate program they have to run", async () => {
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText(/es un programa aparte/i)).toBeInTheDocument();
    expect(screen.getByText(/dejarlo corriendo/i)).toBeInTheDocument();
  });

  it("renders the currently active URL from GET /api/ptt/state", async () => {
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText(defaultPttState.stt_ws_url as string)).toBeInTheDocument();
    expect(screen.getByLabelText("URL de conexión")).toHaveValue(defaultPttState.stt_ws_url);
  });

  it("shows 'sin configurar' when the backend has no URL saved yet", async () => {
    server.use(pttStateHandler({ ...defaultPttState, stt_ws_url: null }));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("sin configurar")).toBeInTheDocument();
  });

  it("saves a new URL via Guardar and reflects it in the active-URL readout", async () => {
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.change(screen.getByLabelText("URL de conexión"), {
      target: { value: "ws://192.168.1.5:9090" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("ws://192.168.1.5:9090")).toBeInTheDocument();
  });

  it("surfaces the server's 422 reason instead of a generic failure", async () => {
    server.use(pttConfigValidationErrorHandler("stt_ws_uri must use ws:// or wss://"));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.change(screen.getByLabelText("URL de conexión"), { target: { value: "ws://" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("stt_ws_uri must use ws:// or wss://")).toBeInTheDocument();
  });

  it("catches an invalid scheme client-side, without hitting the network", async () => {
    let putCalls = 0;
    server.use(
      http.put(`${API_BASE_URL}/api/ptt/config`, () => {
        putCalls += 1;
        return HttpResponse.json({ stt_ws_uri: "http://127.0.0.1:9090" });
      })
    );
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.change(screen.getByLabelText("URL de conexión"), {
      target: { value: "http://127.0.0.1:9090" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText(/debe empezar con ws:\/\/ o wss:\/\//)).toBeInTheDocument();
    expect(putCalls).toBe(0);
  });

  it("Probar conexión renders a reachable result distinctly from a failed one", async () => {
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Conectado.").closest("[data-tone]")).toHaveAttribute("data-tone", "ok");

    server.use(pttTestHandler({ ok: false, detail: "Connection refused" }));
    fireEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("Connection refused").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "danger"
    );
  });

  it("disables Guardar while the save mutation is in flight", async () => {
    let resolvePut: (() => void) | undefined;
    server.use(
      http.put(
        `${API_BASE_URL}/api/ptt/config`,
        () =>
          new Promise((resolve) => {
            resolvePut = () => resolve(HttpResponse.json({ stt_ws_uri: "ws://192.168.1.5:9090" }));
          })
      )
    );
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    fireEvent.change(screen.getByLabelText("URL de conexión"), {
      target: { value: "ws://192.168.1.5:9090" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    await act(async () => {
      resolvePut?.();
      await vi.advanceTimersByTimeAsync(0);
    });
  });
});
