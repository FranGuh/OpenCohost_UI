import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError } from "./client.js";
import {
  PronunciationValidationError,
  getPronunciation,
  putPronunciation
} from "./pronunciation.js";

const LIMITS = { max_entries: 200, match_max: 64, replace_max: 128 };

describe("pronunciation client", () => {
  it("getPronunciation returns entries and limits", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/tts/pronunciation`, () =>
        HttpResponse.json({ entries: [{ match: "OBS", replace: "o be ese" }], limits: LIMITS })
      )
    );
    await expect(getPronunciation()).resolves.toEqual({
      entries: [{ match: "OBS", replace: "o be ese" }],
      limits: LIMITS
    });
  });

  it("getPronunciation throws ApiError on a non-ok status", async () => {
    server.use(http.get(`${API_BASE_URL}/api/tts/pronunciation`, () => new HttpResponse(null, { status: 500 })));
    await expect(getPronunciation()).rejects.toMatchObject({ status: 500 });
  });

  it("putPronunciation sends the full list as JSON and returns the saved shape", async () => {
    const seen: { body: unknown; contentType: string | null }[] = [];
    server.use(
      http.put(`${API_BASE_URL}/api/tts/pronunciation`, async ({ request }) => {
        const body = await request.json();
        seen.push({ body, contentType: request.headers.get("content-type") });
        return HttpResponse.json({ ...(body as object), limits: LIMITS });
      })
    );
    const entries = [{ match: "GG", replace: "bien jugado" }];
    await expect(putPronunciation(entries)).resolves.toEqual({ entries, limits: LIMITS });
    expect(seen[0].body).toEqual({ entries });
    expect(seen[0].contentType).toContain("application/json");
  });

  it("maps a 422 to PronunciationValidationError carrying errors[]", async () => {
    const errors = [{ index: 1, field: "match", code: "duplicate" }];
    server.use(
      http.put(`${API_BASE_URL}/api/tts/pronunciation`, () =>
        HttpResponse.json({ detail: "invalid_pronunciation", errors }, { status: 422 })
      )
    );
    const err = await putPronunciation([]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PronunciationValidationError);
    expect((err as PronunciationValidationError).errors).toEqual(errors);
    expect((err as PronunciationValidationError).status).toBe(422);
  });

  it("a 422 with a malformed body yields an empty errors list", async () => {
    server.use(http.put(`${API_BASE_URL}/api/tts/pronunciation`, () => new HttpResponse("nope", { status: 422 })));
    const err = await putPronunciation([]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PronunciationValidationError);
    expect((err as PronunciationValidationError).errors).toEqual([]);
  });

  it("maps a 503 to an ApiError that never includes the entries", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/tts/pronunciation`, () =>
        HttpResponse.json({ detail: "pronunciation_write_failed" }, { status: 503 })
      )
    );
    const err = await putPronunciation([{ match: "secretword", replace: "x" }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).message).not.toContain("secretword");
  });

  it("passes ?locale= query param on GET and PUT when locale is specified", async () => {
    const seenUrls: { method: string; url: string }[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/tts/pronunciation`, ({ request }) => {
        seenUrls.push({ method: "GET", url: request.url });
        return HttpResponse.json({ entries: [{ match: "API", replace: "ei pi ai" }], limits: LIMITS });
      }),
      http.put(`${API_BASE_URL}/api/tts/pronunciation`, async ({ request }) => {
        seenUrls.push({ method: "PUT", url: request.url });
        const body = (await request.json()) as { entries: { match: string; replace: string }[] };
        return HttpResponse.json({ entries: body.entries, limits: LIMITS });
      })
    );
    await getPronunciation("en");
    await putPronunciation([{ match: "GG", replace: "gee gee" }], "en");
    await getPronunciation("en-US");
    await putPronunciation([{ match: "OK", replace: "okay" }], "ES_MX");
    expect(seenUrls).toEqual([
      { method: "GET", url: `${API_BASE_URL}/api/tts/pronunciation?locale=en` },
      { method: "PUT", url: `${API_BASE_URL}/api/tts/pronunciation?locale=en` },
      { method: "GET", url: `${API_BASE_URL}/api/tts/pronunciation?locale=en` },
      { method: "PUT", url: `${API_BASE_URL}/api/tts/pronunciation?locale=es` }
    ]);
  });
});
