import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { ConversationPanel } from "./ConversationPanel.js";

vi.mock("../../api/liveTranscript.js", () => ({ useLiveTranscript: () => undefined }));

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_B64 = btoa(String.fromCharCode(...PNG_BYTES));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

type Phase = "off" | "starting" | "warming" | "ready" | "failed";

interface Script {
  phase: Phase;
  lastError?: string | null;
  /** One entry per POST /api/chat/turn, consumed in order; the last repeats. */
  turns: Array<{ status: number; detail?: string; gate?: Promise<void> }>;
}

/** Set once the panel has fetched GET /api/vision (paste needs vision data). */
let visionServed = false;

function serve(script: Script) {
  const posts: Array<{ text?: string; image?: { data: string } }> = [];
  visionServed = false;
  server.use(
    http.get(`${API_BASE_URL}/api/vision`, () => {
      visionServed = true;
      return HttpResponse.json({
        enabled: script.phase !== "off",
        look_on_ptt: false,
        capture_delay_s: 0,
        rule_gate_enabled: false,
        model: "qwen3-vl",
        port: 1,
        describe_timeout_s: 8,
        status: {
          daemon_state: "running",
          model_installed: true,
          capture_available: true,
          armed: false,
          looking: false,
          state: script.phase,
          last_error: script.lastError ?? null
        }
      });
    }),
    http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
      posts.push((await request.json()) as never);
      const step = script.turns[Math.min(posts.length - 1, script.turns.length - 1)]!;
      if (step.gate) await step.gate;
      if (step.status === 200) {
        return HttpResponse.json({ accepted: true, command_id: "cmd_1", status: "queued", state_version: 1 });
      }
      return HttpResponse.json({ detail: step.detail }, { status: step.status });
    })
  );
  return posts;
}

function pasteFile(target: HTMLElement) {
  const file = new File([PNG_BYTES], "shot.png", { type: "image/png" });
  fireEvent.paste(target, {
    clipboardData: { items: [{ kind: "file", type: file.type, getAsFile: () => file }], files: [file], getData: () => "" }
  });
}

async function composerWithImage(text = "") {
  const box = await screen.findByRole("combobox", { name: "Message for Kira" });
  // The composer no longer shows a vision readout; wait for the vision fetch and
  // let the query settle before pasting (paste needs vision data).
  await waitFor(() => expect(visionServed).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  pasteFile(box);
  await screen.findByRole("button", { name: "Remove image" });
  if (text) await userEvent.type(box, text);
  return box;
}

const send = () => userEvent.click(screen.getByRole("button", { name: "Send" }));

describe("ConversationPanel image in the conversation", () => {
  let revoke: ReturnType<typeof vi.fn>;
  let seq = 0;
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "en" });
    seq = 0;
    revoke = vi.fn();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => `blob:preview-${++seq}`);
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = revoke;
  });
  afterEach(() => {
    useUiLocaleStore.setState({ locale: "es" });
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  describe("readiness indicator", () => {
    // Owner decision 2026-11-25: no "Vision: …" readout above the composer in
    // any phase; vision state lives in the Controls tab.
    it.each(["off", "starting", "warming", "ready", "failed"] as const)(
      "shows no vision readout above the composer when %s",
      async (phase) => {
        serve({ phase, lastError: phase === "failed" ? "port_in_use" : null, turns: [{ status: 200 }] });
        renderPanel();
        await screen.findByRole("combobox", { name: "Message for Kira" });
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(screen.queryByRole("status", { name: /^Vision:/ })).toBeNull();
        expect(screen.queryByText(/^Vision:/)).toBeNull();
      }
    );
  });

  it("lets an image be attached and sent while vision is starting, with a waiting line on the message", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const posts = serve({ phase: "starting", turns: [{ status: 200, gate }] });
    renderPanel();
    await composerWithImage("what is this");
    await send();
    expect(await screen.findByText("Waiting for vision…")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Image you sent" })).toBeInTheDocument();
    // the composer is not frozen: the text field is empty and editable
    const box = screen.getByRole("combobox", { name: "Message for Kira" });
    expect(box).toHaveValue("");
    await userEvent.type(box, "next");
    expect(box).toHaveValue("next");
    release();
    await waitFor(() => expect(screen.queryByText("Waiting for vision…")).toBeNull());
    expect(posts).toHaveLength(1);
  });

  it("says it is reading the image when vision is already ready", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    serve({ phase: "ready", turns: [{ status: 200, gate }] });
    renderPanel();
    await composerWithImage();
    await send();
    expect(await screen.findByText("Reading the image…")).toBeInTheDocument();
    release();
  });

  it("shows the typed text and the thumbnail together, and enlarges on click", async () => {
    serve({ phase: "ready", turns: [{ status: 200 }] });
    renderPanel();
    await composerWithImage("look at this");
    await send();
    expect(await screen.findByText("look at this")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enlarge image" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  describe("failure", () => {
    it.each([
      [504, "vision_describe_timeout", "Vision took too long to read the image."],
      [503, "vision_starting", "Vision was not ready yet, so the image could not be read."],
      [503, "vision_failed", "Vision could not read the image."],
      [422, "vision_off", "Vision is off, so the image could not be read."]
    ])("%s %s shows a specific message on the failed message", async (status, detail, copy) => {
      serve({ phase: "ready", turns: [{ status, detail }] });
      renderPanel();
      await composerWithImage("hi");
      await send();
      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
      // the generic send alert does not repeat it
      expect(screen.queryByText(/POST \/api\/chat\/turn failed/)).toBeNull();
    });

    it("Retry resends the same text and image and clears the failure on success", async () => {
      const posts = serve({
        phase: "ready",
        turns: [{ status: 503, detail: "vision_starting" }, { status: 200 }]
      });
      renderPanel();
      await composerWithImage("same again");
      await send();
      await screen.findByText("Vision was not ready yet, so the image could not be read.");
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(posts).toHaveLength(2));
      expect(posts[1]).toEqual(posts[0]);
      expect(posts[1]!.image?.data).toBe(PNG_B64);
      await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
      expect(screen.getByRole("img", { name: "Image you sent" })).toBeInTheDocument();
    });

    it("a second failure on Retry shows the new cause", async () => {
      serve({
        phase: "ready",
        turns: [{ status: 503, detail: "vision_starting" }, { status: 504, detail: "vision_describe_timeout" }]
      });
      renderPanel();
      await composerWithImage();
      await send();
      await screen.findByText("Vision was not ready yet, so the image could not be read.");
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("Vision took too long to read the image.")).toBeInTheDocument();
    });

    it("Discard removes the message and releases its preview, leaving the composer clean", async () => {
      const posts = serve({ phase: "ready", turns: [{ status: 504, detail: "vision_describe_timeout" }] });
      renderPanel();
      const box = await composerWithImage("gone");
      await send();
      await screen.findByText("Vision took too long to read the image.");
      await userEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(screen.queryByRole("img", { name: "Image you sent" })).toBeNull();
      expect(screen.queryByText("gone")).toBeNull();
      expect(box).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();
      await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:preview-1"));
      expect(posts).toHaveLength(1);
    });
  });

  describe("memory only", () => {
    it("revokes the preview when the panel unmounts and never writes the image to storage", async () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      serve({ phase: "ready", turns: [{ status: 200 }] });
      const view = renderPanel();
      await composerWithImage();
      await send();
      await screen.findByRole("img", { name: "Image you sent" });
      view.unmount();
      expect(revoke).toHaveBeenCalledWith("blob:preview-1");
      for (const call of setItem.mock.calls) expect(String(call[1])).not.toContain(PNG_B64);
      setItem.mockRestore();
    });

    it("revokes an attachment that is removed before sending", async () => {
      serve({ phase: "ready", turns: [{ status: 200 }] });
      renderPanel();
      await composerWithImage();
      await userEvent.click(screen.getByRole("button", { name: "Remove image" }));
      await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:preview-1"));
    });

    it("falls back to an in-memory data URL when the platform has no object URLs", async () => {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
      serve({ phase: "ready", turns: [{ status: 200 }] });
      renderPanel();
      await composerWithImage();
      await send();
      const thumb = await screen.findByRole("img", { name: "Image you sent" });
      expect(thumb.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    });
  });
});
