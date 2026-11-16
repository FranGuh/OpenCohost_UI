import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ChatImageError, ConflictError, ValidationError, postChatTurn } from "./client.js";

const IMAGE = { data: "QUJD", mime_type: "image/png" } as const;

function failWith(status: number, detail: unknown) {
  server.use(http.post(`${API_BASE_URL}/api/chat/turn`, () => HttpResponse.json({ detail }, { status })));
}

describe("postChatTurn image failures", () => {
  it.each([
    [504, "vision_describe_timeout"],
    [503, "vision_starting"],
    [503, "vision_failed"],
    [422, "vision_off"],
    [422, "vision_disabled"],
    [502, "vision_describe_http"]
  ])("turns %s %s into a ChatImageError carrying the stable code", async (status, code) => {
    failWith(status, code);
    const error = await postChatTurn("hi", "k", IMAGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChatImageError);
    expect((error as ChatImageError).code).toBe(code);
    expect((error as ChatImageError).status).toBe(status);
  });

  it("keeps ConflictError for the engine-unavailable 409", async () => {
    failWith(409, { error: "ENGINE_UNAVAILABLE" });
    await expect(postChatTurn("hi", "k", IMAGE)).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps ValidationError for non-vision 422 details", async () => {
    failWith(422, "image content does not match its mime type");
    await expect(postChatTurn("hi", "k", IMAGE)).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not apply the image mapping to a plain text turn", async () => {
    failWith(504, "vision_describe_timeout");
    const error = await postChatTurn("hi", "k").catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ChatImageError);
  });

  it("an unrecognised failure body still throws a plain ApiError", async () => {
    server.use(http.post(`${API_BASE_URL}/api/chat/turn`, () => new HttpResponse("boom", { status: 500 })));
    const error = await postChatTurn("hi", "k", IMAGE).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ChatImageError);
    expect((error as { status: number }).status).toBe(500);
  });
});
