import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { useEventStore } from "../../store/eventStore.js";
import { useSpeechProgressStore } from "../../store/speechProgressStore.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { API_BASE_URL, lastReplyHandler } from "../../test/handlers.js";
import { SPEECH_TEXT_MAX_LENGTH } from "../../api/speech.js";
import { ConversationPanel } from "./ConversationPanel.js";

vi.mock("../../api/liveTranscript.js", () => ({ useLiveTranscript: () => undefined }));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

type SayBody = { text: string; mode: string };

function sayCapture(response: () => Response = () => HttpResponse.json({ job_id: 1 })) {
  const bodies: SayBody[] = [];
  server.use(
    http.post(`${API_BASE_URL}/api/speech/say`, async ({ request }) => {
      bodies.push((await request.json()) as SayBody);
      return response();
    })
  );
  return bodies;
}

function stateHandler(state: { paused: boolean; readaloud_active: boolean; readaloud_pending: number }) {
  server.use(http.get(`${API_BASE_URL}/api/speech/state`, () => HttpResponse.json(state)));
}

const REPLY = "Primera frase de prueba. Segunda frase de prueba.";

async function renderWithReply(extra: Record<string, unknown> = {}) {
  server.use(lastReplyHandler({ text: REPLY, turn_id: 1, ...extra }));
  renderPanel();
  await screen.findByText(/Primera frase de prueba/);
}

function selectInKiraTurn(text: string) {
  const content = document.querySelector("[data-kira-turn]") as HTMLElement;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !(node.textContent ?? "").includes(text)) node = walker.nextNode();
  if (!node) throw new Error("text node not found");
  const start = (node.textContent ?? "").indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  act(() => {
    fireEvent.mouseUp(content);
  });
}

beforeEach(() => {
  useUiLocaleStore.setState({ locale: "en" });
  useEventStore.setState({ events: [] });
  useSpeechProgressStore.getState().reset();
  window.getSelection()?.removeAllRanges();
});

describe("ConversationPanel read aloud", () => {
  it("per-turn Read aloud queues the full turn text", async () => {
    const bodies = sayCapture();
    await renderWithReply();
    fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
    await waitFor(() => expect(bodies).toEqual([{ text: REPLY, mode: "queue" }]));
  });

  it("Read aloud is disabled while the reply is still streaming", async () => {
    await renderWithReply({ is_streaming: true });
    expect(screen.getByRole("button", { name: "Read aloud" })).toBeDisabled();
  });

  it("Read aloud is disabled while that turn is being spoken", async () => {
    await renderWithReply();
    act(() => useSpeechProgressStore.getState().setProgress(true, 0, 2, 1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Read aloud" })).toBeDisabled());
  });

  it("a read-aloud speech (no feed turn) never highlights the newest reply", async () => {
    await renderWithReply({ fragments: ["Primera frase de prueba.", "Segunda frase de prueba."] });
    act(() =>
      useSpeechProgressStore
        .getState()
        .setProgress(true, 0, 1, null, { jobId: 9, fragment: "Segunda frase de prueba." })
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(document.querySelector(".oc-reading-active")).toBeNull();
  });

  it("selection inside one Kira turn offers Read selection (queue) and Read now", async () => {
    const bodies = sayCapture();
    await renderWithReply();
    expect(screen.queryByRole("button", { name: "Read selection" })).toBeNull();
    selectInKiraTurn("Segunda frase de prueba.");
    fireEvent.click(await screen.findByRole("button", { name: "Read selection" }));
    await waitFor(() => expect(bodies).toEqual([{ text: "Segunda frase de prueba.", mode: "queue" }]));
    selectInKiraTurn("Primera frase ");
    fireEvent.click(await screen.findByRole("button", { name: "Read now" }));
    await waitFor(() => expect(bodies[1]).toEqual({ text: "Primera frase", mode: "now" }));
  });

  it("ignores a selection outside Kira turns", async () => {
    await renderWithReply();
    const range = document.createRange();
    range.selectNodeContents(screen.getAllByRole("tablist")[0]);
    window.getSelection()!.addRange(range);
    act(() => {
      fireEvent.mouseUp(document.body);
    });
    expect(screen.queryByRole("button", { name: "Read selection" })).toBeNull();
  });

  it("disables selection actions over the character cap", async () => {
    const long = "palabra ".repeat(600).trim();
    expect(long.length).toBeGreaterThan(SPEECH_TEXT_MAX_LENGTH);
    server.use(lastReplyHandler({ text: long, turn_id: 1 }));
    renderPanel();
    await screen.findByText(/palabra palabra/);
    selectInKiraTurn(long);
    expect(await screen.findByRole("button", { name: "Read selection" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Read now" })).toBeDisabled();
  });

  it("shows the playback bar from state and wires Stop and Pause", async () => {
    stateHandler({ paused: false, readaloud_active: true, readaloud_pending: 1 });
    let stopped = 0;
    let paused = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/speech/stop`, () => {
        stopped += 1;
        return HttpResponse.json({ discarded: 1 });
      }),
      http.post(`${API_BASE_URL}/api/speech/pause`, () => {
        paused += 1;
        return HttpResponse.json({ paused: true });
      })
    );
    await renderWithReply();
    fireEvent.click(await screen.findByRole("button", { name: "Stop reading" }));
    await waitFor(() => expect(stopped).toBe(1));
    fireEvent.click(await screen.findByRole("button", { name: "Pause speech" }));
    await waitFor(() => expect(paused).toBe(1));
  });

  it("shows Resume when the backend reports paused", async () => {
    stateHandler({ paused: true, readaloud_active: false, readaloud_pending: 0 });
    let resumed = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/speech/resume`, () => {
        resumed += 1;
        return HttpResponse.json({ paused: false });
      })
    );
    await renderWithReply();
    fireEvent.click(await screen.findByRole("button", { name: "Resume speech" }));
    await waitFor(() => expect(resumed).toBe(1));
  });

  it("hides the playback bar when idle", async () => {
    await renderWithReply();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: "Stop reading" })).toBeNull();
  });

  it("shows a friendly message on GUARD_BLOCKED without leaking the rule or text", async () => {
    sayCapture(() => HttpResponse.json({ detail: { error: "GUARD_BLOCKED", rule: "R9" } }, { status: 422 }));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await renderWithReply();
    fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
    expect(await screen.findByText("Kira can't read that text aloud.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("R9");
    for (const call of [...err.mock.calls, ...log.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain("Primera frase");
    }
    err.mockRestore();
    log.mockRestore();
  });

  it("shows a speech unavailable message on 503", async () => {
    sayCapture(() => HttpResponse.json({ detail: { error: "SPEECH_UNAVAILABLE" } }, { status: 503 }));
    await renderWithReply();
    fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
    expect(await screen.findByText("Speech is unavailable right now.")).toBeInTheDocument();
  });
});

describe("ConversationPanel vision", () => {
  it("hides the Look at this control (the rule gate triggers looks)", async () => {
    renderPanel();
    await screen.findByRole("combobox");
    expect(screen.queryByRole("button", { name: "Look at this" })).toBeNull();
  });
});
