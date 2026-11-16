import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
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
import { PTT_STATE_QUERY_KEY, useUpdatePttConfigMutation } from "../../api/ptt.js";
import { PTTCard } from "./PTTCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PTTCard)));
}

function holdButton() {
  return screen.getByRole("button", { name: "Mantén para hablar" });
}

beforeEach(() => {
  vi.useFakeTimers();
  act(() => useUiLocaleStore.setState({ locale: "es" }));
});
afterEach(() => {
  vi.useRealTimers();
  act(() => useUiLocaleStore.setState({ locale: "es" }));
});

describe("PTTCard: idle defaults", () => {
  it("renders idle with the hold button and the background hotkey selector", async () => {
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(holdButton()).toBeInTheDocument();
    expect(screen.getByText("PTT · Push-to-Talk")).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Atajo de teclado" });
    expect(select).toBeInTheDocument();
    expect(select).toHaveTextContent("F10");
    expect(screen.getByText(/Tecla global para hablar en segundo plano/)).toBeInTheDocument();
  });

  it("allows selecting a different hotkey and sends PUT /api/ptt/config with hotkey", async () => {
    let capturedBody: any = null;
    server.use(
      http.put(`${API_BASE_URL}/api/ptt/config`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ stt_ws_uri: "ws://127.0.0.1:8765", hotkey: capturedBody.hotkey });
      })
    );
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    const select = screen.getByRole("combobox", { name: "Atajo de teclado" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "F8" }));

    // Fake timers are on for this suite, so RTL's waitFor would never tick.
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(capturedBody).toEqual({ hotkey: "F8" });
  });
});

describe("PTTCard: dictation mode (ptt-dictation-20261111)", () => {
  it("shows the saved mode and offers the three choices", async () => {
    server.use(pttStateHandler({ ...defaultPttState, dictation_mode: "foreground" }));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));
    const select = screen.getByRole("combobox", { name: "Al soltar PTT" });
    expect(select).toHaveTextContent("Escribir en el chat si la app está al frente");
    fireEvent.click(select);
    expect(screen.getByRole("option", { name: "Enviar a Kira" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Escribir en el chat si la app está al frente" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Escribir siempre en el chat" })).toBeInTheDocument();
  });

  it("defaults to send when the backend does not report a mode (older API)", async () => {
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("combobox", { name: "Al soltar PTT" })).toHaveTextContent("Enviar a Kira");
  });

  it("saves a new mode through PUT /api/ptt/config with dictation_mode only", async () => {
    let capturedBody: unknown = null;
    let currentState = { ...defaultPttState };
    server.use(
      http.get(`${API_BASE_URL}/api/ptt/state`, () => HttpResponse.json(currentState)),
      http.put(`${API_BASE_URL}/api/ptt/config`, async ({ request }) => {
        capturedBody = await request.json();
        currentState = { ...currentState, stt_ws_url: "ws://127.0.0.1:9090", hotkey: "F10", dictation_mode: "always" };
        return HttpResponse.json({ stt_ws_uri: "ws://127.0.0.1:9090", hotkey: "F10", dictation_mode: "always" });
      })
    );
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("combobox", { name: "Al soltar PTT" }));
    fireEvent.click(screen.getByRole("option", { name: "Escribir siempre en el chat" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(capturedBody).toEqual({ dictation_mode: "always" });
    expect(screen.getByRole("combobox", { name: "Al soltar PTT" })).toHaveTextContent("Escribir siempre en el chat");
  });

  it("renders the switch in English", async () => {
    act(() => useUiLocaleStore.setState({ locale: "en" }));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));
    const select = screen.getByRole("combobox", { name: "When you release PTT" });
    expect(select).toHaveTextContent("Send to Kira");
  });

  it("companion switch: off by default and disabled unless the mode is 'always'", async () => {
    for (const mode of ["send", "foreground"] as const) {
      server.use(pttStateHandler({ ...defaultPttState, dictation_mode: mode }));
      const { unmount } = renderCard();
      await act(() => vi.advanceTimersByTimeAsync(0));
      const sw = screen.getByRole("switch", { name: "Dictar también desde el compañero de escritorio" });
      expect(sw).toHaveAttribute("aria-checked", "false");
      expect(sw).toBeDisabled();
      unmount();
    }
  });

  it("companion switch: enabled in 'always' mode and saves companion_dictation only", async () => {
    let capturedBody: unknown = null;
    let currentState = { ...defaultPttState, dictation_mode: "always" as const, companion_dictation: false };
    server.use(
      http.get(`${API_BASE_URL}/api/ptt/state`, () => HttpResponse.json(currentState)),
      http.put(`${API_BASE_URL}/api/ptt/config`, async ({ request }) => {
        capturedBody = await request.json();
        currentState = { ...currentState, companion_dictation: true };
        return HttpResponse.json({
          stt_ws_uri: "ws://127.0.0.1:9090",
          dictation_mode: "always",
          companion_dictation: true
        });
      })
    );
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));
    const sw = screen.getByRole("switch", { name: "Dictar también desde el compañero de escritorio" });
    expect(sw).toBeEnabled();
    fireEvent.click(sw);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(capturedBody).toEqual({ companion_dictation: true });
    expect(screen.getByRole("switch", { name: "Dictar también desde el compañero de escritorio" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("companion switch: reflects a saved 'on' value and has an English label", async () => {
    act(() => useUiLocaleStore.setState({ locale: "en" }));
    server.use(pttStateHandler({ ...defaultPttState, dictation_mode: "always", companion_dictation: true }));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("switch", { name: "Also dictate from the desktop companion" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
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
    expect(screen.getByText("Instala LiveAudio para activar el STT y PTT.")).toBeInTheDocument();
    const warning = screen.getAllByRole("alert").find((alert) =>
      alert.querySelector('a[href="https://liveaudio.opencohost.com/?utm_source=opencohost"]')
    );
    expect(warning).toBeDefined();
  });

  it("offers the LiveAudio download link in the persistent hint and failed connection warning", async () => {
    server.use(pttTestHandler({ ok: false, detail: "Connection refused" }));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    const persistentLink = screen.getByRole("link", { name: "Descargar LiveAudio en liveaudio.opencohost.com" });
    expect(persistentLink).toHaveAttribute("href", "https://liveaudio.opencohost.com/?utm_source=opencohost");
    expect(persistentLink).toHaveAttribute("target", "_blank");
    expect(persistentLink).toHaveAttribute("rel", "noreferrer");

    fireEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    const warning = screen.getAllByRole("alert").find((alert) =>
      alert.querySelector('a[href="https://liveaudio.opencohost.com/?utm_source=opencohost"]')
    );
    if (!warning) throw new Error("Expected a LiveAudio warning alert");
    expect(warning).toHaveTextContent(/LiveAudio/i);
    expect(within(warning).getByRole("link", { name: "Descargar LiveAudio en liveaudio.opencohost.com" })).toHaveAttribute(
      "href",
      "https://liveaudio.opencohost.com/?utm_source=opencohost"
    );
  });

  it("renders the persistent LiveAudio link and failure guidance in English", async () => {
    act(() => useUiLocaleStore.setState({ locale: "en" }));
    server.use(pttTestHandler({ ok: false, detail: "Connection refused" }));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole("link", { name: "Download LiveAudio at liveaudio.opencohost.com" })).toHaveAttribute(
      "href",
      "https://liveaudio.opencohost.com/?utm_source=opencohost"
    );
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByText("LiveAudio is unavailable. Install it and try the connection again.")).toBeInTheDocument();
    const warning = screen.getAllByRole("alert").find((alert) =>
      alert.textContent?.includes("LiveAudio is unavailable")
    );
    if (!warning) throw new Error("Expected an English LiveAudio warning alert");
    expect(within(warning).getByRole("link", { name: "Download LiveAudio at liveaudio.opencohost.com" })).toHaveAttribute(
      "href",
      "https://liveaudio.opencohost.com/?utm_source=opencohost"
    );
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
    let currentState = { ...defaultPttState };
    server.use(
      http.get(`${API_BASE_URL}/api/ptt/state`, () => HttpResponse.json(currentState)),
      http.put(`${API_BASE_URL}/api/ptt/config`, async ({ request }) => {
        const body = (await request.json()) as { stt_ws_uri?: string };
        currentState = { ...currentState, stt_ws_url: body.stt_ws_uri ?? currentState.stt_ws_url };
        return HttpResponse.json({ stt_ws_uri: body.stt_ws_uri });
      })
    );
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

  it("localizes the F10 default hotkey badge in English and Spanish", async () => {
    act(() => useUiLocaleStore.setState({ locale: "en" }));
    const first = renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));
    const selectEn = screen.getByRole("combobox", { name: "Keyboard shortcut" });
    expect(selectEn).toHaveTextContent("F10 · Default");
    expect(selectEn).not.toHaveTextContent("Predeterminada");
    first.unmount();

    act(() => useUiLocaleStore.setState({ locale: "es" }));
    renderCard();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("combobox", { name: "Atajo de teclado" })).toHaveTextContent("F10 · Predeterminada");
  });

  it("useUpdatePttConfigMutation invalidates PTT_STATE_QUERY_KEY onSettled even without cached data", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useUpdatePttConfigMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ hotkey: "F9" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: PTT_STATE_QUERY_KEY });
  });
});
