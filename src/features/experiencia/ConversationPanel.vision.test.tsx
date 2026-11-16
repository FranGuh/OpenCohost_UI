import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { useVisionResultStore } from "../../store/visionStore.js";
import { API_BASE_URL, lastReplyHandler } from "../../test/handlers.js";
import { ConversationPanel } from "./ConversationPanel.js";

vi.mock("../../api/liveTranscript.js", () => ({ useLiveTranscript: () => undefined }));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

function serveVision(enabled: boolean, status: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  const calls = { looks: 0, turns: [] as string[], order: [] as string[], statusReads: 0 };
  server.use(
    http.get(`${API_BASE_URL}/api/vision`, () => {
      calls.statusReads += 1;
      return HttpResponse.json({
        enabled,
        look_on_ptt: false,
        capture_delay_s: 0,
        rule_gate_enabled: false,
        model: "m",
        port: 1,
        describe_timeout_s: 8,
        ...settings,
        status: { daemon_state: "running", model_installed: true, capture_available: true, armed: false, looking: false, state: enabled ? "ready" : "off", ...status }
      });
    }),
    http.post(`${API_BASE_URL}/api/vision/look`, () => {
      calls.looks += 1;
      calls.order.push("look");
      return HttpResponse.json({ armed: true });
    }),
    http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
      const body = (await request.json()) as { text?: string; message?: string };
      calls.turns.push(String(body.text ?? body.message ?? ""));
      calls.order.push("turn");
      return HttpResponse.json({ accepted: true, queued: false });
    })
  );
  return calls;
}

describe("ConversationPanel vision badge", () => {
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "en" });
    useVisionResultStore.setState({ results: [] });
  });
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("shows 'Looked at your screen · 2.1 s' on the Kira reply that follows an ok look", async () => {
    useVisionResultStore.setState({ results: [{ id: "srv-1", ts: 1_000_000, outcome: "ok", describeMs: 2100 }] });
    server.use(lastReplyHandler({ text: "Veo un editor de codigo.", turn_id: 1, ts: 1_002 }));
    renderPanel();
    expect(await screen.findByText("Looked at your screen · 2.1 s")).toBeInTheDocument();
  });

  it("shows a friendly reason, never raw codes, when the look failed", async () => {
    useVisionResultStore.setState({ results: [{ id: "srv-1", ts: 1_000_000, outcome: "describe_timeout", describeMs: null }] });
    server.use(lastReplyHandler({ text: "No he visto nada.", turn_id: 1, ts: 1_002 }));
    renderPanel();
    expect(await screen.findByText("Couldn't look: it took too long")).toBeInTheDocument();
    expect(screen.queryByText(/describe_timeout/)).toBeNull();
  });

  it("shows no badge on a reply with no look", async () => {
    server.use(lastReplyHandler({ text: "Hola.", turn_id: 1, ts: 1_002 }));
    renderPanel();
    await screen.findByText("Hola.");
    expect(screen.queryByText(/Looked at your screen|Couldn't look/)).toBeNull();
  });
});

describe("ConversationPanel vision thumbnails (V1.12)", () => {
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "en" });
    useVisionResultStore.setState({ results: [] });
  });
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  function seed(extra: Record<string, unknown> = {}) {
    useVisionResultStore.setState({
      results: [{ id: "srv-1", ts: 1_000_000, outcome: "ok", describeMs: 2900, lookId: "look-1", framesSent: 3, ...extra }]
    });
    server.use(lastReplyHandler({ text: "Veo un editor.", turn_id: 1, ts: 1_002 }));
  }
  const thumbs = (frames: string[]) =>
    http.get(`${API_BASE_URL}/api/vision/looks/look-1/thumbnails`, () => HttpResponse.json({ id: "look-1", thumbnails: frames }));

  it("shows the frame count in the ok badge when several frames were sent", async () => {
    seed();
    renderPanel();
    expect(await screen.findByText("Looked at your screen · 3 frames · 2.9 s")).toBeInTheDocument();
  });

  it("fetches nothing until the badge is opened, then shows a stepper over the frames", async () => {
    seed();
    let fetched = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/vision/looks/look-1/thumbnails`, () => {
        fetched += 1;
        return HttpResponse.json({
          id: "look-1",
          thumbnails: ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB", "data:image/jpeg;base64,CCC"]
        });
      })
    );
    renderPanel();
    const toggle = await screen.findByRole("button", { name: /what Kira saw/i });
    expect(fetched).toBe(0);
    await userEvent.click(toggle);
    const img = await screen.findByRole("img", { name: /Frame 1 of 3/ });
    expect(img).toHaveAttribute("src", "data:image/jpeg;base64,AAA");
    expect(screen.getByText("1/3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Frame 2 of 3/ })).toHaveAttribute("src", "data:image/jpeg;base64,BBB");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("labels a clip honestly: mosaic chip and mosaic image, never 'Frame 1 of 1'", async () => {
    seed({ framesSent: 6, mode: "clip", describeMs: 3900 });
    server.use(thumbs(["data:image/jpeg;base64,MOSAIC"]));
    renderPanel();
    expect(await screen.findByText("Looked at a clip · 6 frames as a mosaic")).toBeInTheDocument();
    expect(screen.queryByText(/3\.9 s/)).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /what Kira saw/i }));
    expect(await screen.findByRole("img", { name: /Mosaic of 6 frames/ })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Frame 1 of 1/ })).toBeNull();
  });

  it("labels the inline clip thumbnail as a mosaic when thumbnails are shown inline", async () => {
    seed({ framesSent: 6, mode: "clip" });
    serveVision(true, {}, { show_thumbnails: true });
    server.use(thumbs(["data:image/jpeg;base64,MOSAIC"]));
    renderPanel();
    expect(await screen.findByRole("img", { name: /Mosaic of 6 frames/ })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Frame 1 of 1/ })).toBeNull();
  });

  it("keeps the normal wording for a normal-mode look", async () => {
    seed({ mode: "normal" });
    renderPanel();
    expect(await screen.findByText("Looked at your screen · 3 frames · 2.9 s")).toBeInTheDocument();
  });

  it("shows a single image with no stepper", async () => {
    seed({ framesSent: 1 });
    server.use(thumbs(["data:image/jpeg;base64,AAA"]));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /what Kira saw/i }));
    await screen.findByRole("img", { name: /Frame 1 of 1/ });
    expect(screen.queryByRole("button", { name: "Next frame" })).toBeNull();
  });

  it("says the thumbnail is gone on a 404", async () => {
    seed();
    server.use(http.get(`${API_BASE_URL}/api/vision/looks/look-1/thumbnails`, () => new HttpResponse(null, { status: 404 })));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /what Kira saw/i }));
    expect(await screen.findByText("Thumbnail no longer available")).toBeInTheDocument();
  });

  it("drops the images when collapsed", async () => {
    seed({ framesSent: 1 });
    server.use(thumbs(["data:image/jpeg;base64,AAA"]));
    renderPanel();
    const toggle = await screen.findByRole("button", { name: /what Kira saw/i });
    await userEvent.click(toggle);
    await screen.findByRole("img", { name: /Frame 1 of 1/ });
    await userEvent.click(screen.getByRole("button", { name: /hide/i }));
    expect(screen.queryByRole("img", { name: /Frame 1 of 1/ })).toBeNull();
  });

  it("has no toggle without a look id (older backend) or on a failed look", async () => {
    seed({ lookId: null });
    renderPanel();
    await screen.findByText(/Looked at your screen/);
    expect(screen.queryByRole("button", { name: /what Kira saw/i })).toBeNull();
  });

  it("explains self_capture in friendly copy", async () => {
    seed({ outcome: "self_capture", lookId: "look-1" });
    renderPanel();
    expect(await screen.findByText("Couldn't look: OpenCohost was in front, so Kira only saw herself")).toBeInTheDocument();
  });
});

describe("ConversationPanel inline thumbnails (V1.16)", () => {
  const FRAMES = ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"];
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "en" });
    useVisionResultStore.setState({ results: [] });
  });
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  function seedTwoLooks() {
    useVisionResultStore.setState({
      results: [
        { id: "srv-1", ts: 1_000_000, outcome: "ok", describeMs: 1000, lookId: "look-1", framesSent: 2 },
        { id: "srv-2", ts: 1_010_000, outcome: "ok", describeMs: 1000, lookId: "look-2", framesSent: 1 }
      ]
    });
    server.use(
      lastReplyHandler({ text: "Primera respuesta.", turn_id: 1, ts: 1_002 }),
      http.get(`${API_BASE_URL}/api/vision/looks/look-1/thumbnails`, () => HttpResponse.json({ id: "look-1", thumbnails: FRAMES })),
      http.get(`${API_BASE_URL}/api/vision/looks/look-2/thumbnails`, () => HttpResponse.json({ id: "look-2", thumbnails: ["data:image/jpeg;base64,ZZZ"] }))
    );
  }

  it("shows the frames inline without expanding when show_thumbnails is on", async () => {
    seedTwoLooks();
    serveVision(true, {}, { show_thumbnails: true });
    renderPanel();
    const imgs = await screen.findAllByRole("img", { name: /Frame \d of 2/ });
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", FRAMES[0]);
    expect(screen.queryByRole("button", { name: /what Kira saw/i })).toBeNull();
  });

  it("does not fetch or show frames when show_thumbnails is off", async () => {
    seedTwoLooks();
    let fetched = 0;
    server.use(http.get(`${API_BASE_URL}/api/vision/looks/look-1/thumbnails`, () => { fetched += 1; return HttpResponse.json({ id: "look-1", thumbnails: FRAMES }); }));
    serveVision(true, {}, { show_thumbnails: false });
    renderPanel();
    await screen.findByText(/Looked at your screen/);
    expect(screen.queryByRole("img", { name: /Frame/ })).toBeNull();
    expect(fetched).toBe(0);
  });

  it("enlarges a thumbnail in a lightbox that closes with Esc", async () => {
    seedTwoLooks();
    serveVision(true, {}, { show_thumbnails: true });
    renderPanel();
    await userEvent.click((await screen.findAllByRole("img", { name: /Frame 1 of 2/ }))[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")).toHaveAttribute("src", FRAMES[0]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the lightbox on backdrop click", async () => {
    seedTwoLooks();
    serveVision(true, {}, { show_thumbnails: true });
    renderPanel();
    await userEvent.click((await screen.findAllByRole("img", { name: /Frame 1 of 2/ }))[0]!);
    await userEvent.click(await screen.findByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a quiet expired hint on 404", async () => {
    seedTwoLooks();
    server.use(http.get(`${API_BASE_URL}/api/vision/looks/look-1/thumbnails`, () => new HttpResponse(null, { status: 404 })));
    serveVision(true, {}, { show_thumbnails: true });
    renderPanel();
    expect(await screen.findByText("Image expired")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("binds each reply to its own look id", async () => {
    useVisionResultStore.setState({
      results: [
        { id: "srv-1", ts: 1_000_000, outcome: "ok", describeMs: 1, lookId: "look-1", framesSent: 1 },
        { id: "srv-2", ts: 1_010_000, outcome: "ok", describeMs: 1, lookId: "look-2", framesSent: 1 }
      ]
    });
    server.use(
      http.get(`${API_BASE_URL}/api/vision/looks/look-1/thumbnails`, () => HttpResponse.json({ id: "look-1", thumbnails: ["data:image/jpeg;base64,ONE"] })),
      http.get(`${API_BASE_URL}/api/vision/looks/look-2/thumbnails`, () => HttpResponse.json({ id: "look-2", thumbnails: ["data:image/jpeg;base64,TWO"] }))
    );
    serveVision(true, {}, { show_thumbnails: true });
    const { attachVisionBadges } = await import("./visionBadge.js");
    const badges = attachVisionBadges(
      [
        { id: "a", role: "kira", text: "x", ts: 1_001_000 },
        { id: "b", role: "kira", text: "y", ts: 1_011_000 }
      ],
      useVisionResultStore.getState().results
    );
    expect(badges.get("a")?.lookId).toBe("look-1");
    expect(badges.get("b")?.lookId).toBe("look-2");
  });
});

describe("ConversationPanel look commands (V1.10)", () => {
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "en" });
    useVisionResultStore.setState({ results: [] });
  });
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  async function composer() {
    return screen.findByRole("combobox");
  }

  it("/mira <text> arms the look first, then sends only the remainder", async () => {
    const calls = serveVision(true);
    renderPanel();
    const input = await composer();
    await waitFor(() => expect(calls.statusReads).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    await userEvent.type(input, "/mira what is this{Enter}");
    await waitFor(() => expect(calls.turns).toEqual(["what is this"]));
    expect(calls.order).toEqual(["look", "turn"]);
    expect(calls.looks).toBe(1);
  });

  it("a bare !look only arms and sends nothing", async () => {
    const calls = serveVision(true);
    renderPanel();
    const input = await composer();
    await waitFor(() => expect(calls.statusReads).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    await userEvent.type(input, "!look{Enter}");
    await waitFor(() => expect(calls.looks).toBe(1));
    expect(calls.turns).toEqual([]);
    expect(input).toHaveValue("");
  });

  it("when vision is off, does not send the command text, keeps the draft and says why inline", async () => {
    const calls = serveVision(false);
    renderPanel();
    const input = await composer();
    await waitFor(() => expect(calls.statusReads).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    await userEvent.type(input, "/look hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Vision isn't ready");
    expect(calls.turns).toEqual([]);
    expect(calls.looks).toBe(0);
    expect(input).toHaveValue("/look hello");
  });

  it("does not open the command palette for a look command", async () => {
    serveVision(true);
    renderPanel();
    const input = await composer();
    await userEvent.type(input, "/m");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await userEvent.type(input, "ira");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
