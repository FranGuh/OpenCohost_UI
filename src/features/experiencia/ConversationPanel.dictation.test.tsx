import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { defaultPttState, pttStateHandler } from "../../test/handlers.js";
import { useEventStore } from "../../store/eventStore.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { setToastSink } from "../../lib/appEvents.js";
import { ConversationPanel } from "./ConversationPanel.js";

// ptt-dictation-20261111: the LiveAudio echo hook is unit-tested in
// src/api/liveTranscript.test.ts; here it is mocked down to its contract so
// the panel's composer insertion is driven directly.
type Dictation = {
  onDictated: (text: string) => void;
  onDictationLost: () => void;
  onLiveStart?: () => void;
  onLive?: (text: string) => void;
  onLiveCancel?: () => void;
  onDictationTimeout?: () => void;
};
let transcriptCb: ((text: string, stamp: number) => void) | null = null;
let pendingCb: ((text: string | null) => void) | null = null;
let dictation: Dictation | null = null;
vi.mock("../../api/liveTranscript.js", () => ({
  useLiveTranscript: (
    cb: (text: string, stamp: number) => void,
    onPending?: (text: string | null) => void,
    handlers?: Dictation
  ) => {
    transcriptCb = cb;
    pendingCb = onPending ?? null;
    dictation = handlers ?? null;
  }
}));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

const composer = () => screen.getByPlaceholderText("Escribe un mensaje para Kira…") as HTMLTextAreaElement;

function dictate(text: string) {
  act(() => dictation?.onDictated(text));
}

beforeEach(() => {
  useEventStore.setState({ events: [] });
  act(() => useUiLocaleStore.setState({ locale: "es" }));
  transcriptCb = null;
  pendingCb = null;
  dictation = null;
});
afterEach(() => {
  setToastSink(null);
  act(() => useUiLocaleStore.setState({ locale: "es" }));
});

describe("ConversationPanel — PTT dictation into the composer", () => {
  it("wires dictation handlers into the transcript hook", () => {
    renderPanel();
    expect(dictation).not.toBeNull();
    expect(transcriptCb).not.toBeNull();
  });

  it("appends to an untouched composer and never renders the hold as a sent voice turn", () => {
    renderPanel();
    fireEvent.change(composer(), { target: { value: "ya tenía esto" } });
    act(() => pendingCb?.("hola kira dictado"));
    act(() => pendingCb?.(null)); // the hook clears the pending row before handing over
    dictate("hola kira dictado");
    expect(composer().value).toBe("ya tenía esto hola kira dictado");
    expect(screen.queryByText("Anónimo · voz")).not.toBeInTheDocument();
    expect(screen.queryByText("Turno de voz enviado")).not.toBeInTheDocument();
    expect(screen.getByText("Dictado en el cuadro de mensaje. Revísalo y pulsa Enviar.")).toBeInTheDocument();
  });

  it("replaces the selection captured before the composer lost focus", () => {
    renderPanel();
    const el = composer();
    fireEvent.change(el, { target: { value: "hola MUNDO cruel" } });
    act(() => {
      el.focus();
      el.setSelectionRange(5, 10);
    });
    fireEvent.select(el);
    // The owner clicks the mic: the textarea blurs, and a later re-render could
    // move its live selection, so the panel must use what it captured.
    act(() => {
      el.blur();
      el.setSelectionRange(0, 0);
    });
    dictate("gente");
    expect(composer().value).toBe("hola gente cruel");
  });

  it("inserts at the caret and leaves the caret after the inserted text", () => {
    renderPanel();
    const el = composer();
    fireEvent.change(el, { target: { value: "holamundo" } });
    act(() => {
      el.focus();
      el.setSelectionRange(4, 4);
    });
    fireEvent.select(el);
    dictate("querido");
    expect(composer().value).toBe("hola querido mundo");
    expect(composer().selectionStart).toBe("hola querido".length);
    expect(composer().selectionEnd).toBe("hola querido".length);
  });

  it("two dictations in a row land one after the other", () => {
    renderPanel();
    dictate("primera frase");
    dictate("segunda frase");
    expect(composer().value).toBe("primera frase segunda frase");
  });

  it("shows a visible notice when the backend dictated but this window has no text", () => {
    const sink = vi.fn();
    setToastSink(sink);
    renderPanel();
    act(() => dictation?.onDictationLost());
    expect(
      screen.getByText(
        "El dictado no llegó a esta ventana, así que no hay texto para insertar. No se envió nada a Kira. Intenta de nuevo."
      )
    ).toBeInTheDocument();
    expect(sink).toHaveBeenCalledWith("No se capturó el dictado de PTT; no se envió nada", "warn");
    expect(composer().value).toBe("");
  });

  it("a flushed hold in a dictation mode still renders as the sent voice turn", async () => {
    server.use(pttStateHandler({ ...defaultPttState, dictation_mode: "foreground" }));
    renderPanel();
    act(() => transcriptCb?.("esto sí se envió", 0));
    expect(screen.getByText("esto sí se envió")).toBeInTheDocument();
    expect(screen.getByText("Anónimo · voz")).toBeInTheDocument();
    expect(composer().value).toBe("");
  });
});

// ptt-live-dictation-20261125: a hold the backend locked to dictate writes the
// words into the composer live (the hook drives these handlers).
describe("ConversationPanel — live dictation into the composer", () => {
  const input = () => document.getElementById("composer-input") as HTMLTextAreaElement;
  const focusAt = (el: HTMLTextAreaElement, start: number, end = start) => {
    act(() => {
      el.focus();
      el.setSelectionRange(start, end);
    });
    fireEvent.select(el);
  };
  const live = (text: string) => act(() => dictation?.onLive?.(text));
  const start = () => act(() => dictation?.onLiveStart?.());

  it("inserts at the caret and updates the same span progressively without duplicates", () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: "holamundo" } });
    focusAt(input(), 4);
    start();
    live("querido");
    expect(input().value).toBe("hola querido mundo");
    live("querido amigo");
    expect(input().value).toBe("hola querido amigo mundo");
    act(() => dictation?.onDictated("querido amigo mío"));
    expect(input().value).toBe("hola querido amigo mío mundo");
    expect(input().selectionStart).toBe("hola querido amigo mío".length);
    expect(input().selectionEnd).toBe("hola querido amigo mío".length);
  });

  it("replaces the selection captured when the hold began", () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: "hola MUNDO cruel" } });
    focusAt(input(), 5, 10);
    act(() => input().blur());
    start();
    live("gente");
    expect(input().value).toBe("hola gente cruel");
    live("gente linda");
    expect(input().value).toBe("hola gente linda cruel");
  });

  it("appends at the end, with one separating space, when the input was never focused", () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: "ya escrito" } });
    start();
    live("hola kira");
    expect(input().value).toBe("ya escrito hola kira");
  });

  it("shows the input as dictating (read-only) and unlocks after the final outcome", () => {
    renderPanel();
    start();
    expect(input()).toHaveAttribute("readonly");
    expect(screen.getByPlaceholderText("Dictando…")).toBeInTheDocument();
    live("hola kira");
    act(() => dictation?.onDictated("hola kira"));
    expect(input()).not.toHaveAttribute("readonly");
    expect(input().value).toBe("hola kira");
  });

  it("disables the Send button while dictating and re-enables it afterwards", () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: "base" } });
    const send = () => screen.getByRole("button", { name: "Enviar" });
    expect(send()).not.toBeDisabled();
    start();
    live("hola kira");
    expect(send()).toBeDisabled();
    act(() => dictation?.onDictated("hola kira"));
    expect(send()).not.toBeDisabled();
  });

  it("renders no pending voice bubble during a dictation hold", () => {
    renderPanel();
    start();
    live("hola kira");
    expect(screen.queryByText("Anónimo · voz")).not.toBeInTheDocument();
  });

  it("restores the original input when the hold ends up sent instead of dictated", () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: "base" } });
    start();
    live("hola kira");
    expect(input().value).toBe("base hola kira");
    act(() => dictation?.onLiveCancel?.());
    expect(input().value).toBe("base");
    expect(input()).not.toHaveAttribute("readonly");
  });

  it("send holds keep the pending bubble and leave the composer alone", () => {
    renderPanel();
    fireEvent.change(input(), { target: { value: "base" } });
    act(() => pendingCb?.("hola kira"));
    expect(screen.getByText("hola kira")).toBeInTheDocument();
    expect(screen.getByText("Anónimo · voz")).toBeInTheDocument();
    expect(input().value).toBe("base");
  });

  it("on outcome timeout keeps the live text, unlocks and shows an incomplete-dictation notice", () => {
    renderPanel();
    start();
    live("hola kira");
    act(() => dictation?.onDictationTimeout?.());
    expect(input().value).toBe("hola kira");
    expect(input()).not.toHaveAttribute("readonly");
    expect(
      screen.getByText("El dictado puede estar incompleto: no llegó la confirmación. El texto se conservó en el cuadro de mensaje; revísalo.")
    ).toBeInTheDocument();
  });
});

