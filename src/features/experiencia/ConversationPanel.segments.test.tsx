import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { useEventStore } from "../../store/eventStore.js";
import { useSpeechProgressStore } from "../../store/speechProgressStore.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { lastReplyHandler } from "../../test/handlers.js";
import { ConversationPanel } from "./ConversationPanel.js";
import { segmentReply } from "./segmentReply.js";

vi.mock("../../api/liveTranscript.js", () => ({ useLiveTranscript: () => undefined }));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

const P1 = "Buena pregunta. Lo primero es revisar la cola de mensajes, porque ahí se ve si el chat llega bien al motor.";
const P2 = "Después mira el registro de la voz. Si la voz tarda, lo normal es que el modelo esté cargando todavía.";
const P3 = "Y si nada de eso ayuda, reinicia el motor desde Controles. ¿Te sirve así?";
const LONG_REPLY = `${P1}\n\n${P2}\n\n${P3}`;

beforeEach(() => {
  useUiLocaleStore.setState({ locale: "en" });
  useEventStore.setState({ events: [] });
  useSpeechProgressStore.getState().reset();
});

describe("ConversationPanel segmented Kira replies", () => {
  it("renders a long reply as several bubbles inside one labelled group", async () => {
    const expected = segmentReply(LONG_REPLY);
    expect(expected.length).toBeGreaterThan(1);
    server.use(lastReplyHandler({ text: LONG_REPLY, turn_id: 1 }));
    renderPanel();
    await screen.findByText(/Lo primero es revisar/);

    // One group per reply, named by its single KIRA header.
    const group = screen.getByRole("group", { name: "KIRA" });
    const bubbles = group.querySelectorAll("[data-reply-segment]");
    expect(bubbles).toHaveLength(expected.length);
    expect(within(bubbles[0] as HTMLElement).getByText(/Lo primero es revisar/)).toBeInTheDocument();
    expect(within(bubbles[bubbles.length - 1] as HTMLElement).getByText(/¿Te sirve así\?/)).toBeInTheDocument();
    expect(screen.getAllByText("KIRA")).toHaveLength(1);
    // The selection/highlight contract keeps one container for the whole reply.
    expect(document.querySelectorAll("[data-kira-turn]")).toHaveLength(1);
    expect(group).toHaveAttribute("data-kira-turn");
  });

  it("keeps a short reply as one bubble", async () => {
    server.use(lastReplyHandler({ text: "¡Hola! ¿Qué tal estás hoy?", turn_id: 1 }));
    renderPanel();
    await screen.findByText(/Qué tal estás hoy/);
    const group = screen.getByRole("group", { name: "KIRA" });
    expect(group.querySelectorAll("[data-reply-segment]")).toHaveLength(1);
  });

  it("copies the whole reply, not one bubble", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    server.use(lastReplyHandler({ text: LONG_REPLY, turn_id: 1 }));
    renderPanel();
    await screen.findByText(/Lo primero es revisar/);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(LONG_REPLY));
  });
});
