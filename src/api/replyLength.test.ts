import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { getReplyLength, putReplyLength } from "./replyLength.js";

describe("reply length client", () => {
  it("getReplyLength returns the mode", async () => {
    server.use(http.get(`${API_BASE_URL}/api/reply-length`, () => HttpResponse.json({ mode: "long" })));
    await expect(getReplyLength()).resolves.toEqual({ mode: "long" });
  });

  it("getReplyLength throws ApiError on a non-ok status", async () => {
    server.use(http.get(`${API_BASE_URL}/api/reply-length`, () => new HttpResponse(null, { status: 500 })));
    await expect(getReplyLength()).rejects.toMatchObject({ status: 500 });
  });

  it("putReplyLength sends the mode as JSON and returns the saved shape", async () => {
    const seen: { body: unknown; contentType: string | null }[] = [];
    server.use(
      http.put(`${API_BASE_URL}/api/reply-length`, async ({ request }) => {
        const body = await request.json();
        seen.push({ body, contentType: request.headers.get("content-type") });
        return HttpResponse.json(body);
      })
    );
    await expect(putReplyLength("very_long")).resolves.toEqual({ mode: "very_long" });
    expect(seen).toEqual([{ body: { mode: "very_long" }, contentType: "application/json" }]);
  });

  it("putReplyLength throws ApiError carrying the status on 422 and 503", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/reply-length`, () =>
        HttpResponse.json({ detail: "invalid_reply_length" }, { status: 422 })
      )
    );
    await expect(putReplyLength("short")).rejects.toMatchObject({ status: 422 });
    server.use(
      http.put(`${API_BASE_URL}/api/reply-length`, () =>
        HttpResponse.json({ detail: "reply_length_write_failed" }, { status: 503 })
      )
    );
    await expect(putReplyLength("short")).rejects.toMatchObject({ status: 503 });
  });
});
