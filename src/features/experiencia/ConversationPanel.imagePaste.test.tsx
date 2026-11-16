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

interface TurnBody {
  text?: string;
  image?: { data: string; mime_type?: string };
}

const visionReads = { n: 0 };

function serve(opts: { visionEnabled: boolean; model?: string; turnStatus?: number }) {
  const turns: TurnBody[] = [];
  visionReads.n = 0;
  server.use(
    http.get(`${API_BASE_URL}/api/vision`, () => {
      visionReads.n += 1;
      return HttpResponse.json({
        enabled: opts.visionEnabled,
        look_on_ptt: false,
        capture_delay_s: 0,
        rule_gate_enabled: false,
        model: opts.model ?? "qwen3-vl",
        port: 1,
        describe_timeout_s: 8,
        status: { daemon_state: "running", model_installed: true, capture_available: true, armed: false, looking: false, state: opts.visionEnabled ? "ready" : "off" }
      });
    }),
    http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
      turns.push((await request.json()) as TurnBody);
      if (opts.turnStatus && opts.turnStatus !== 200) {
        return HttpResponse.json({ detail: "vision_describe_timeout" }, { status: opts.turnStatus });
      }
      return HttpResponse.json({ accepted: true, command_id: "cmd_1", status: "queued", state_version: 1 });
    })
  );
  return turns;
}

function pasteFile(target: HTMLElement, file: File | null, text = "") {
  const items = file ? [{ kind: "file", type: file.type, getAsFile: () => file }] : [];
  if (text) items.push({ kind: "string", type: "text/plain", getAsFile: () => null } as never);
  fireEvent.paste(target, { clipboardData: { items, files: file ? [file] : [], getData: () => text } });
}

const pngFile = () => new File([PNG_BYTES], "shot.png", { type: "image/png" });
const removeButton = () => screen.queryByRole("button", { name: "Remove image" });

async function composer() {
  const box = await screen.findByRole("combobox", { name: "Message for Kira" });
  // Wait for the vision query to settle so a paste sees the real gate.
  await waitFor(() => expect(visionReads.n).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 60));
  return box;
}

describe("ConversationPanel pasted image", () => {
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "en" });
    // jsdom has no object URLs: a stable fake keeps the bytes out of the DOM.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => "blob:preview-1");
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    useUiLocaleStore.setState({ locale: "es" });
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it("attaches the pasted image as a removable chip when vision is on and a model is set", async () => {
    serve({ visionEnabled: true });
    renderPanel();
    const box = await composer();
    pasteFile(box, pngFile());
    expect(await screen.findByRole("button", { name: "Remove image" })).toBeInTheDocument();
    expect(screen.getByText("Image attached")).toBeInTheDocument();
  });

  it("blocks the paste with an inline hint when vision is off", async () => {
    serve({ visionEnabled: false });
    renderPanel();
    const box = await composer();
    pasteFile(box, pngFile());
    expect(await screen.findByText("Turn on vision with a model in Controls to paste images.")).toBeInTheDocument();
    expect(removeButton()).toBeNull();
  });

  it("blocks the paste when vision is on but no model is set", async () => {
    serve({ visionEnabled: true, model: "" });
    renderPanel();
    const box = await composer();
    pasteFile(box, pngFile());
    expect(await screen.findByText("Turn on vision with a model in Controls to paste images.")).toBeInTheDocument();
    expect(removeButton()).toBeNull();
  });

  it("rejects an unsupported image type with a hint", async () => {
    serve({ visionEnabled: true });
    renderPanel();
    const box = await composer();
    pasteFile(box, new File([PNG_BYTES], "a.gif", { type: "image/gif" }));
    expect(await screen.findByText("Only PNG, JPEG or WebP images can be pasted.")).toBeInTheDocument();
    expect(removeButton()).toBeNull();
  });

  it("leaves a plain-text paste alone: no chip, no hint", async () => {
    serve({ visionEnabled: true });
    renderPanel();
    const box = await composer();
    pasteFile(box, null, "just text");
    expect(removeButton()).toBeNull();
    expect(screen.queryByText(/paste images|Only PNG/)).toBeNull();
  });

  it("removes the chip", async () => {
    serve({ visionEnabled: true });
    renderPanel();
    const box = await composer();
    pasteFile(box, pngFile());
    await userEvent.click(await screen.findByRole("button", { name: "Remove image" }));
    expect(removeButton()).toBeNull();
  });

  it("sends the image with the turn, clears the chip on success and shows the thumbnail in the bubble", async () => {
    const turns = serve({ visionEnabled: true });
    renderPanel();
    const box = await composer();
    pasteFile(box, pngFile());
    await screen.findByRole("button", { name: "Remove image" });
    await userEvent.type(box, "what is this?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0]!.text).toBe("what is this?");
    expect(turns[0]!.image).toEqual({ data: PNG_B64, mime_type: "image/png" });
    await waitFor(() => expect(removeButton()).toBeNull());
    // the bubble shows the sent image (owner decision 2026-11-10), from a local URL
    const thumb = await screen.findByRole("img", { name: "Image you sent" });
    expect(thumb).toHaveAttribute("src", "blob:preview-1");
    expect(document.body.innerHTML).not.toContain(PNG_B64);
  });

  it("sends an image-only turn", async () => {
    const turns = serve({ visionEnabled: true });
    renderPanel();
    const box = await composer();
    pasteFile(box, pngFile());
    await screen.findByRole("button", { name: "Remove image" });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0]!.image?.mime_type).toBe("image/png");
  });

  it("keeps the failed message in the conversation and leaves the composer free", async () => {
    const turns = serve({ visionEnabled: true, turnStatus: 504 });
    renderPanel();
    const box = await composer();
    pasteFile(box, pngFile());
    await screen.findByRole("button", { name: "Remove image" });
    await userEvent.type(box, "hi");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(turns).toHaveLength(1));
    expect(await screen.findByText("Vision took too long to read the image.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Image you sent" })).toBeInTheDocument();
    expect(removeButton()).toBeNull();
    expect(box).toHaveValue("");
  });
});
