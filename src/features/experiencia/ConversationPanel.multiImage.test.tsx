import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { ConversationPanel } from "./ConversationPanel.js";

vi.mock("../../api/liveTranscript.js", () => ({ useLiveTranscript: () => undefined }));

// Runtime-fixes-20261110 T7: up to three images per message.

const HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const bytesOf = (tag: number) => new Uint8Array([...HEAD, tag, tag, tag]);
const b64Of = (tag: number) => btoa(String.fromCharCode(...bytesOf(tag)));
const pngFile = (tag: number) => new File([bytesOf(tag)], `shot-${tag}.png`, { type: "image/png" });

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

interface Post {
  text?: string;
  image?: { data: string };
  images?: Array<{ data: string }>;
}

function serve(opts: { maxImages?: number | null; turns?: Array<{ status: number; detail?: string; extra?: object }> } = {}) {
  const posts: Post[] = [];
  const turns = opts.turns ?? [{ status: 200 }];
  server.use(
    http.get(`${API_BASE_URL}/api/vision`, () =>
      HttpResponse.json({
        enabled: true,
        look_on_ptt: false,
        capture_delay_s: 0,
        rule_gate_enabled: false,
        model: "qwen3-vl",
        port: 1,
        describe_timeout_s: 8,
        ...(opts.maxImages === null ? {} : { max_images: opts.maxImages ?? 3 }),
        status: { daemon_state: "running", model_installed: true, capture_available: true, armed: false, looking: false, state: "ready" }
      })
    ),
    http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
      posts.push((await request.json()) as Post);
      const step = turns[Math.min(posts.length - 1, turns.length - 1)]!;
      if (step.status === 200) {
        return HttpResponse.json({ accepted: true, command_id: "cmd_1", status: "queued", state_version: 1 });
      }
      return HttpResponse.json({ detail: step.detail, ...(step.extra ?? {}) }, { status: step.status });
    })
  );
  return posts;
}

function paste(target: HTMLElement, files: File[]) {
  const items = files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file }));
  fireEvent.paste(target, { clipboardData: { items, files, getData: () => "" } });
}

async function composer() {
  const box = await screen.findByRole("combobox", { name: "Message for Kira" });
  await waitFor(() => expect(screen.queryByRole("status", { name: /^Vision:/ })).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 60));
  return box;
}

const chips = () => screen.queryAllByRole("button", { name: /^Remove image/ });
const send = () => userEvent.click(screen.getByRole("button", { name: "Send" }));
const NOTICE = "You can attach up to 3 images";

describe("ConversationPanel several images", () => {
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

  it("keeps a second paste next to the first, each with its own numbered remove button", async () => {
    serve();
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1)]);
    await screen.findByRole("button", { name: "Remove image" }); // a single image keeps its plain label
    paste(box, [pngFile(2)]);
    await waitFor(() => expect(chips()).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Remove image 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove image 2" })).toBeInTheDocument();
  });

  it("two quick pastes both land (the last reader does not win)", async () => {
    serve();
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1)]);
    paste(box, [pngFile(2)]);
    await waitFor(() => expect(chips()).toHaveLength(2));
  });

  it("attaches as many as fit from a multi-image paste and shows the notice for the rest", async () => {
    const posts = serve();
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1), pngFile(2), pngFile(3), pngFile(4), pngFile(5)]);
    await waitFor(() => expect(chips()).toHaveLength(3));
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await send();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.images!.map((i) => i.data)).toEqual([b64Of(1), b64Of(2), b64Of(3)]);
  });

  it("pasting at the limit replaces nothing and shows the notice", async () => {
    const posts = serve();
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1), pngFile(2), pngFile(3)]);
    await waitFor(() => expect(chips()).toHaveLength(3));
    expect(screen.queryByText(NOTICE)).toBeNull();
    paste(box, [pngFile(9)]);
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(chips()).toHaveLength(3);
    await send();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.images!.map((i) => i.data)).toEqual([b64Of(1), b64Of(2), b64Of(3)]);
  });

  it("removing one image frees a slot and the others stay in order", async () => {
    const posts = serve();
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1), pngFile(2), pngFile(3)]);
    await waitFor(() => expect(chips()).toHaveLength(3));
    await userEvent.click(screen.getByRole("button", { name: "Remove image 2" }));
    expect(chips()).toHaveLength(2);
    paste(box, [pngFile(4)]);
    await waitFor(() => expect(chips()).toHaveLength(3));
    await send();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.images!.map((i) => i.data)).toEqual([b64Of(1), b64Of(3), b64Of(4)]);
  });

  it("the limit comes from the backend status; an older backend without it allows one", async () => {
    serve({ maxImages: 2 });
    const first = renderPanel();
    let box = await composer();
    paste(box, [pngFile(1), pngFile(2), pngFile(3)]);
    await waitFor(() => expect(chips()).toHaveLength(2));
    expect(await screen.findByText("You can attach up to 2 images")).toBeInTheDocument();
    first.unmount();
    cleanup();

    serve({ maxImages: null });
    renderPanel();
    box = await composer();
    paste(box, [pngFile(1), pngFile(2)]);
    await screen.findByRole("button", { name: "Remove image" });
    expect(await screen.findByText("You can attach only one image")).toBeInTheDocument();
  });

  it("a single image still goes out in the legacy single-image shape", async () => {
    const posts = serve();
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1)]);
    await screen.findByRole("button", { name: "Remove image" });
    await send();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.image).toEqual({ data: b64Of(1), mime_type: "image/png" });
    expect(posts[0]!.images).toBeUndefined();
  });

  it("shows every thumbnail in a compact row and enlarges the one clicked", async () => {
    serve();
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1), pngFile(2), pngFile(3)]);
    await waitFor(() => expect(chips()).toHaveLength(3));
    await send();
    const thumbs = await screen.findAllByRole("img", { name: /^Image \d of 3 you sent$/ });
    expect(thumbs).toHaveLength(3);
    expect(thumbs.map((img) => img.getAttribute("src"))).toEqual(["blob:preview-1", "blob:preview-2", "blob:preview-3"]);
    await userEvent.click(screen.getByRole("button", { name: "Enlarge image 2" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")).toHaveAttribute("src", "blob:preview-2");
  });

  it("a failed multi-image turn names the image, queues nothing, and Retry resends all images and the text", async () => {
    const posts = serve({
      turns: [
        { status: 504, detail: "vision_describe_timeout", extra: { image_index: 1, image_total: 3, described: 1 } },
        { status: 200 }
      ]
    });
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1), pngFile(2), pngFile(3)]);
    await waitFor(() => expect(chips()).toHaveLength(3));
    await userEvent.type(box, "all of these");
    await send();
    expect(await screen.findByText("Vision took too long to read the image.")).toBeInTheDocument();
    expect(screen.getByText("Image 2 of 3 could not be read. Nothing was sent.")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /you sent$/ })).toHaveLength(3);
    expect(chips()).toHaveLength(0); // the composer is free again
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[1]!.text).toBe("all of these");
    expect(posts[1]!.images).toHaveLength(3);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
    expect(screen.getAllByRole("img", { name: /you sent$/ })).toHaveLength(3);
  });

  it("Discard removes the message and releases every preview URL", async () => {
    serve({ turns: [{ status: 503, detail: "vision_starting" }] });
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1), pngFile(2), pngFile(3)]);
    await waitFor(() => expect(chips()).toHaveLength(3));
    await send();
    await screen.findByRole("button", { name: "Discard" });
    expect(revoke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(3));
    expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(["blob:preview-1", "blob:preview-2", "blob:preview-3"]);
  });

  it("removing an attachment revokes only that image, and unmount releases the rest", async () => {
    serve();
    const view = renderPanel();
    const box = await composer();
    paste(box, [pngFile(1), pngFile(2)]);
    await waitFor(() => expect(chips()).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:preview-1"));
    expect(revoke).not.toHaveBeenCalledWith("blob:preview-2");
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:preview-2");
  });

  it("never keeps image bytes in browser storage or in the DOM", async () => {
    serve();
    renderPanel();
    const box = await composer();
    paste(box, [pngFile(1), pngFile(2)]);
    await waitFor(() => expect(chips()).toHaveLength(2));
    await send();
    await screen.findAllByRole("img", { name: /you sent$/ });
    expect(document.body.innerHTML).not.toContain(b64Of(1));
    expect(JSON.stringify({ ...localStorage })).not.toContain(b64Of(1));
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(b64Of(1));
  });
});
