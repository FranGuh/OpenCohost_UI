import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, lastReplyHandler } from "../../test/handlers.js";
import { useEventStore } from "../../store/eventStore.js";
import { useLogsPrefStore } from "../../store/useLogsPref.js";
import { ConversationPanel } from "./ConversationPanel.js";

vi.mock("../../api/liveTranscript.js", () => ({ useLiveTranscript: () => {} }));

const timeline = () => document.getElementById("conversation-panel") as HTMLElement;

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

/** The first poll is the baseline (one old item); later polls honor the `after` cursor. */
function remoteFeed(extra: () => Array<{ seq: number; text: string; accepted_at: number }>) {
  return http.get(`${API_BASE_URL}/api/remote/messages`, ({ request }) => {
    const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
    const all = [{ seq: 1, text: "mensaje viejo", accepted_at: 1 }, ...extra()].map((m) => ({
      ...m,
      device_id: "d1",
      device_label: "Pixel"
    }));
    return HttpResponse.json({ items: all.filter((m) => m.seq > after), latest_seq: all[all.length - 1]!.seq });
  });
}

beforeEach(() => {
  useEventStore.setState({ events: [] });
  useLogsPrefStore.setState({ showLogs: false });
});

describe("ConversationPanel remote phone messages", () => {
  it("shows a phone message with its text and the Mensaje remoto label", async () => {
    let live = false;
    server.use(remoteFeed(() => (live ? [{ seq: 2, text: "hola desde el movil", accepted_at: Date.now() / 1000 }] : [])));
    renderPanel();
    await new Promise((r) => setTimeout(r, 100));
    live = true;
    expect(await screen.findByText("hola desde el movil", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/Mensaje remoto/)).toBeInTheDocument();
    expect(screen.queryByText("mensaje viejo")).not.toBeInTheDocument();
    expect(screen.getAllByText("hola desde el movil")).toHaveLength(1);
  });

  it("orders the phone message before the Kira reply that answers it", async () => {
    const now = Date.now() / 1000;
    let live = false;
    server.use(
      remoteFeed(() => (live ? [{ seq: 2, text: "pregunta del movil", accepted_at: now - 2 }] : [])),
      lastReplyHandler({ text: "respuesta de Kira", turn_id: 1, ts: now })
    );
    renderPanel();
    await screen.findByText("respuesta de Kira");
    live = true;
    await screen.findByText("pregunta del movil", {}, { timeout: 4000 });
    const content = timeline().textContent ?? "";
    expect(content.indexOf("pregunta del movil")).toBeLessThan(content.indexOf("respuesta de Kira"));
  });
});
