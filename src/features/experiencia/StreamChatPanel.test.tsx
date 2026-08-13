import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultStreamChatLive, streamChatMessagesForbiddenHandler } from "../../test/handlers.js";
import {
  STREAM_CHAT_CAP,
  selectStreamChatMessages,
  useStreamChatStore
} from "../../store/streamChatStore.js";
import { StreamChatPanel } from "./StreamChatPanel.js";

function renderPanel(active = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(StreamChatPanel, { active }))
  );
}

function connectedChatLiveHandler(overrides: Partial<typeof defaultStreamChatLive> = {}) {
  return http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
    HttpResponse.json({ ...defaultStreamChatLive, connected: true, platform: "twitch", source_id: "kira", ...overrides })
  );
}

beforeEach(() => {
  useStreamChatStore.setState({ messages: [], cursor: 0, boot: null, session: null, breaks: [] });
});

describe("StreamChatPanel — four states + break dividers", () => {
  it("shows the not-connected state when chat-live reports disconnected AND the buffer is empty", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No hay canal conectado/)).toBeInTheDocument());
  });

  it("shows connected + zero-messages ('waiting') state once chat-live reports connected", async () => {
    server.use(connectedChatLiveHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Esperando mensajes/)).toBeInTheDocument());
    expect(screen.getByText(/Conectado · kira/)).toBeInTheDocument();
  });

  it("renders rows once messages land in the store", async () => {
    server.use(connectedChatLiveHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Esperando mensajes/)).toBeInTheDocument());

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 1, author: "viewer1", text: "hola kira", ts: 1000 }],
        cursor: 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });

    expect(await screen.findByText("hola kira")).toBeInTheDocument();
    expect(screen.getByText("viewer1")).toBeInTheDocument();
  });

  it("shows the forbidden state on a 403 from the messages poll (no operator token)", async () => {
    server.use(connectedChatLiveHandler(), streamChatMessagesForbiddenHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No podés leer el chat desde acá/)).toBeInTheDocument());
  });

  it("renders a quiet engine-restart divider once a boot change resets the store", async () => {
    server.use(connectedChatLiveHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Esperando mensajes/)).toBeInTheDocument());

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 1, author: "viewer1", text: "antes del reinicio", ts: 1 }],
        cursor: 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });
    await screen.findByText("antes del reinicio");

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 2, author: "viewer1", text: "después del reinicio", ts: 2 }],
        cursor: 2,
        boot: 2, // different boot -> engine restarted, buffer reset
        session: 0,
        more_pending: false
      });
    });

    expect(await screen.findByText(/El motor se reinició/)).toBeInTheDocument();
    expect(screen.getByText("después del reinicio")).toBeInTheDocument();
    expect(screen.queryByText("antes del reinicio")).not.toBeInTheDocument();
  });

  // Gap 1: `session` is a SEPARATE signal from `boot` (a channel switch/
  // reconnect, not an engine restart) and gets its own divider copy — the two
  // must not merge into one marker or one message.
  it("renders a quiet session-reset divider distinct from the engine-restart one, and both can show independently", async () => {
    server.use(connectedChatLiveHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Esperando mensajes/)).toBeInTheDocument());

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 1, author: "viewer1", text: "antes", ts: 1 }],
        cursor: 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });
    await screen.findByText("antes");

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 2, author: "viewer1", text: "canal nuevo", ts: 2 }],
        cursor: 2,
        boot: 1, // same boot -> NOT an engine restart
        session: 1, // new session -> reconnect/channel switch
        more_pending: false
      });
    });

    expect(await screen.findByText(/Empezó una conexión nueva/)).toBeInTheDocument();
    expect(screen.queryByText(/El motor se reinició/)).not.toBeInTheDocument();
    expect(screen.getByText("canal nuevo")).toBeInTheDocument();
    expect(screen.queryByText("antes")).not.toBeInTheDocument();
  });

  // Fix 3: the marker is ANCHORED to a row, not a monotonic counter. Once the
  // row it sits above is evicted, the divider goes with it instead of hanging
  // over the whole list for the rest of the session.
  it("drops the divider once eviction pushes its anchor row out of the buffer", async () => {
    server.use(connectedChatLiveHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Esperando mensajes/)).toBeInTheDocument());

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 1, author: "viewer1", text: "antes", ts: 1 }],
        cursor: 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 2, author: "viewer1", text: "canal nuevo", ts: 2 }],
        cursor: 2,
        boot: 1,
        session: 1,
        more_pending: false
      });
    });
    expect(await screen.findByText(/Empezó una conexión nueva/)).toBeInTheDocument();

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: Array.from({ length: STREAM_CHAT_CAP + 5 }, (_, i) => ({
          seq: 3 + i,
          author: "viewer1",
          text: `flood ${3 + i}`,
          ts: 3 + i
        })),
        cursor: STREAM_CHAT_CAP + 7,
        boot: 1,
        session: 1,
        more_pending: false
      });
    });

    await waitFor(() => expect(screen.queryByText(/Empezó una conexión nueva/)).not.toBeInTheDocument());
  });

  // Fix 4: the server pages 50/poll over a 200-deep deque, so a raid can outrun
  // the reader. The seq gap is the ONLY signal the backend gives for it.
  it("renders a dropped-messages divider anchored at the first message after a seq gap", async () => {
    server.use(connectedChatLiveHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Esperando mensajes/)).toBeInTheDocument());

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 1, author: "viewer1", text: "antes del raid", ts: 1 }],
        cursor: 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 90, author: "viewer2", text: "después del raid", ts: 2 }],
        cursor: 90,
        boot: 1,
        session: 0,
        more_pending: true
      });
    });

    expect(await screen.findByText(/Se perdieron mensajes/)).toBeInTheDocument();
    // Both rows stay — a gap is a note in the feed, not a wipe.
    expect(screen.getByText("antes del raid")).toBeInTheDocument();
    expect(screen.getByText("después del raid")).toBeInTheDocument();
  });
});

// Fix 1 regression. This is the exact shipped-broken state: the backend brings
// the socket up on a daemon thread, so the connect POST's own response (which
// the mutation writes straight into the cache) says connected:false while chat
// is already being ingested. The default MSW connect fixture returns
// connected:true, which is what concealed it.
describe("StreamChatPanel — rows never gate on `connected` (Fix 1)", () => {
  it("renders rows while chat-live still reports connected:false", async () => {
    server.use(
      // The DEFAULT fixture already reports connected:false — spelled out here
      // so the test states its own premise instead of leaning on a default.
      http.get(`${API_BASE_URL}/api/stream/chat-live`, () => HttpResponse.json(defaultStreamChatLive)),
      http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, () =>
        HttpResponse.json({
          messages: [{ seq: 1, author: "viewer1", text: "el chat sí está entrando", ts: 1000 }],
          cursor: 1,
          boot: 1,
          session: 0,
          more_pending: false
        })
      )
    );
    renderPanel();

    expect(await screen.findByText("el chat sí está entrando")).toBeInTheDocument();
    // The header — and ONLY the header — carries the connection state.
    expect(screen.getByText(/Desconectado/)).toBeInTheDocument();
    expect(screen.queryByText(/No hay canal conectado/)).not.toBeInTheDocument();
  });

  it("keeps the post-disconnect scrollback readable (the backend retains it on purpose)", async () => {
    // Disconnected chat-live + a buffer that still holds the last rows: the
    // backend deliberately retains the last 200 messages after a disconnect
    // (and tests it end to end), so throwing them away the moment `connected`
    // goes false would contradict its own retention.
    renderPanel();
    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 1, author: "viewer1", text: "lo último que dijeron", ts: 1 }],
        cursor: 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });

    await waitFor(() => expect(screen.getByText(/Desconectado/)).toBeInTheDocument());
    expect(screen.getByText("lo último que dijeron")).toBeInTheDocument();
    expect(screen.queryByText(/No hay canal conectado/)).not.toBeInTheDocument();
  });
});

// Fix 7: the engine dying mid-poll used to be invisible — the stale chat-live
// cache kept saying "Conectado" over frozen rows.
describe("StreamChatPanel — non-403 poll failure (Fix 7)", () => {
  it("says the feed is not updating and keeps the rows it already has", async () => {
    server.use(connectedChatLiveHandler());
    renderPanel();
    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 1, author: "viewer1", text: "última fila viva", ts: 1 }],
        cursor: 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });
    await screen.findByText("última fila viva");

    server.use(
      http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, () =>
        HttpResponse.json({ detail: "engine gone" }, { status: 503 })
      )
    );

    await waitFor(() => expect(screen.getByText(/no se está actualizando/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText("última fila viva")).toBeInTheDocument();
    // A 503 is not a permissions problem.
    expect(screen.queryByText(/No podés leer el chat desde acá/)).not.toBeInTheDocument();
  });
});

// Gap 2: Tabs (src/ui/Tabs.tsx) keeps this panel mounted while its tab is
// hidden, so the row list re-renders on every poll unless it is gated on
// `active`. The poll itself must NOT be gated (unread dot / 200-deep buffer
// drain), only the row rendering — see the `ponytail:` comment in
// StreamChatPanel.tsx.
describe("StreamChatPanel — active/inactive render gate (Gap 2)", () => {
  it("renders no message rows while inactive", async () => {
    server.use(connectedChatLiveHandler());
    renderPanel(false);
    await waitFor(() => expect(screen.getByText(/Conectado · kira/)).toBeInTheDocument());

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: 1, author: "viewer1", text: "fila oculta", ts: 1000 }],
        cursor: 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });

    expect(screen.queryByText("fila oculta")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("keeps polling and updating the store while inactive (the hook must stay above the render gate)", async () => {
    server.use(
      connectedChatLiveHandler(),
      http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, () =>
        HttpResponse.json({
          messages: [{ seq: 1, author: "viewer1", text: "llegó mientras estaba oculto", ts: 1000 }],
          cursor: 1,
          boot: 1,
          session: 0,
          more_pending: false
        })
      )
    );
    renderPanel(false);

    await waitFor(() =>
      expect(selectStreamChatMessages(useStreamChatStore.getState())).toEqual([
        { seq: 1, author: "viewer1", text: "llegó mientras estaba oculto", ts: 1000 }
      ])
    );
    // The store updated even though the panel is inactive — but nothing
    // reached the DOM (render gate, not a poll gate).
    expect(screen.queryByText("llegó mientras estaba oculto")).not.toBeInTheDocument();
  });

  it("jumps to the newest message on activation instead of leaving the scroll at the oldest", async () => {
    server.use(connectedChatLiveHandler());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container, rerender } = render(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(StreamChatPanel, { active: false }))
    );
    await waitFor(() => expect(screen.getByText(/Conectado · kira/)).toBeInTheDocument());

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: Array.from({ length: 5 }, (_, i) => ({ seq: i + 1, author: "viewer1", text: `msg ${i + 1}`, ts: 1000 + i })),
        cursor: 5,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });

    // jsdom has no layout: force a tall-content geometry so a real jump
    // (scrollTop -> scrollHeight) is distinguishable from the do-nothing case.
    const scrollEl = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: 300 });
    scrollEl.scrollTop = 0; // simulates landing at the top while rows were gated off

    rerender(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(StreamChatPanel, { active: true }))
    );

    await waitFor(() => expect(screen.getByText("msg 5")).toBeInTheDocument());
    expect(scrollEl.scrollTop).toBe(2000);
  });
});

// Fix 2: the follow-the-bottom test used to key on the row COUNT, which freezes
// at STREAM_CHAT_CAP under one-in-one-out eviction — a few minutes into a real
// stream auto-scroll silently died exactly when the feed was busiest.
describe("StreamChatPanel — auto-scroll survives a full buffer (Fix 2)", () => {
  it("still follows the bottom after the buffer is saturated at the cap", async () => {
    server.use(connectedChatLiveHandler());
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByText(/Esperando mensajes/)).toBeInTheDocument());

    // Saturate the buffer: length is now pinned at STREAM_CHAT_CAP forever.
    act(() => {
      useStreamChatStore.getState().ingest({
        messages: Array.from({ length: STREAM_CHAT_CAP }, (_, i) => ({
          seq: i + 1,
          author: "viewer1",
          text: `msg ${i + 1}`,
          ts: i + 1
        })),
        cursor: STREAM_CHAT_CAP,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });
    await screen.findByText(`msg ${STREAM_CHAT_CAP}`);
    expect(selectStreamChatMessages(useStreamChatStore.getState())).toHaveLength(STREAM_CHAT_CAP);

    const scrollEl = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, value: 4000 });
    Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: 300 });
    scrollEl.scrollTop = 3700; // already at the bottom (4000 - 3700 - 300 = 0)

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: STREAM_CHAT_CAP + 1, author: "viewer9", text: "el mensaje nuevo", ts: 9999 }],
        cursor: STREAM_CHAT_CAP + 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });

    await screen.findByText("el mensaje nuevo");
    // The count did NOT change (200 -> 200). Only the last row's identity did.
    expect(selectStreamChatMessages(useStreamChatStore.getState())).toHaveLength(STREAM_CHAT_CAP);
    expect(scrollEl.scrollTop).toBe(4000);
  });

  it("does not yank the operator back down when they have scrolled up to read", async () => {
    server.use(connectedChatLiveHandler());
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByText(/Esperando mensajes/)).toBeInTheDocument());

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: Array.from({ length: STREAM_CHAT_CAP }, (_, i) => ({
          seq: i + 1,
          author: "viewer1",
          text: `msg ${i + 1}`,
          ts: i + 1
        })),
        cursor: STREAM_CHAT_CAP,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });
    await screen.findByText(`msg ${STREAM_CHAT_CAP}`);

    const scrollEl = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, value: 4000 });
    Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: 300 });
    scrollEl.scrollTop = 500; // scrolled way up, reading backlog

    act(() => {
      useStreamChatStore.getState().ingest({
        messages: [{ seq: STREAM_CHAT_CAP + 1, author: "viewer9", text: "otro mensaje", ts: 9999 }],
        cursor: STREAM_CHAT_CAP + 1,
        boot: 1,
        session: 0,
        more_pending: false
      });
    });

    await screen.findByText("otro mensaje");
    expect(scrollEl.scrollTop).toBe(500);
  });
});
