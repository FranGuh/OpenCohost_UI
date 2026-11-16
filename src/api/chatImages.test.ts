import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ChatImageError, chatImageTurnTimeoutMs, postChatTurn } from "./client.js";
import { MAX_IMAGES_FALLBACK, visionMaxImages, type VisionResponse } from "./vision.js";

// Runtime-fixes-20261110 T7.

const A = { data: "QUJD", mime_type: "image/png" as const };
const B = { data: "REVG", mime_type: "image/jpeg" as const };

function capture() {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ accepted: true, command_id: "c", status: "queued", state_version: 1 });
    })
  );
  return bodies;
}

describe("postChatTurn with several images", () => {
  it("keeps the single-image shape for one image, whether given bare or in a list", async () => {
    const bodies = capture();
    await postChatTurn("a", "k1", A);
    await postChatTurn("b", "k2", [A]);
    expect(bodies[0]).toEqual({ text: "a", image: A });
    expect(bodies[1]).toEqual({ text: "b", image: A });
  });

  it("sends an images list for two or more", async () => {
    const bodies = capture();
    await postChatTurn("c", "k3", [A, B]);
    expect(bodies[0]).toEqual({ text: "c", images: [A, B] });
  });

  it("sends plain text for an empty list", async () => {
    const bodies = capture();
    await postChatTurn("d", "k4", []);
    expect(bodies[0]).toEqual({ text: "d" });
  });

  it("gives the request one cold start plus one max describe call per image", () => {
    expect(chatImageTurnTimeoutMs(0)).toBe(15_000);
    expect(chatImageTurnTimeoutMs(1)).toBe(80_000); // unchanged from T3: 10 + 40 + 30
    expect(chatImageTurnTimeoutMs(2)).toBe(110_000);
    expect(chatImageTurnTimeoutMs(3)).toBe(140_000);
  });

  it("carries the failing image position from the backend on a ChatImageError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, () =>
        HttpResponse.json(
          { detail: "vision_describe_timeout", image_index: 1, image_total: 3, described: 1 },
          { status: 504 }
        )
      )
    );
    const error = (await postChatTurn("x", "k5", [A, B]).catch((e: unknown) => e)) as ChatImageError;
    expect(error).toBeInstanceOf(ChatImageError);
    expect(error.code).toBe("vision_describe_timeout");
    expect(error.failedImage).toEqual({ index: 1, total: 3 });
  });

  it("has no failing-image position when the backend sends none", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, () => HttpResponse.json({ detail: "vision_starting" }, { status: 503 }))
    );
    const error = (await postChatTurn("x", "k6", A).catch((e: unknown) => e)) as ChatImageError;
    expect(error.failedImage).toBeNull();
  });
});

describe("visionMaxImages", () => {
  const base = { enabled: true, status: {} } as unknown as VisionResponse;

  it("reads the backend limit", () => {
    expect(visionMaxImages({ ...base, max_images: 3 })).toBe(3);
  });

  it("allows one image for an older backend that does not report a limit", () => {
    expect(MAX_IMAGES_FALLBACK).toBe(1);
    expect(visionMaxImages(base)).toBe(1);
    expect(visionMaxImages(undefined)).toBe(1);
  });

  it("ignores nonsense", () => {
    expect(visionMaxImages({ ...base, max_images: 0 })).toBe(1);
    expect(visionMaxImages({ ...base, max_images: "3" as unknown as number })).toBe(1);
  });
});
