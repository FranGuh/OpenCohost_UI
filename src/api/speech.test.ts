import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError, ValidationError } from "./client.js";
import {
  GuardBlockedError,
  SPEECH_TEXT_MAX_LENGTH,
  SpeechUnavailableError,
  getSpeechState,
  postSpeechPause,
  postSpeechResume,
  postSpeechSay,
  postSpeechStop
} from "./speech.js";

function captureSay(response: () => Response) {
  const seen: { body: unknown; contentType: string | null }[] = [];
  server.use(
    http.post(`${API_BASE_URL}/api/speech/say`, async ({ request }) => {
      seen.push({ body: await request.json(), contentType: request.headers.get("content-type") });
      return response();
    })
  );
  return seen;
}

describe("speech client", () => {
  it("exposes the 4000 char cap", () => {
    expect(SPEECH_TEXT_MAX_LENGTH).toBe(4000);
  });

  it("postSpeechSay defaults to queue mode and returns the job id", async () => {
    const seen = captureSay(() => HttpResponse.json({ job_id: 7 }));
    await expect(postSpeechSay("hello there")).resolves.toEqual({ job_id: 7 });
    expect(seen[0].body).toEqual({ text: "hello there", mode: "queue" });
    expect(seen[0].contentType).toContain("application/json");
  });

  it("postSpeechSay forwards mode now", async () => {
    const seen = captureSay(() => HttpResponse.json({ job_id: 8 }));
    await postSpeechSay("urgent", "now");
    expect(seen[0].body).toEqual({ text: "urgent", mode: "now" });
  });

  it("maps 422 string detail to ValidationError", async () => {
    captureSay(() => HttpResponse.json({ detail: "text too long" }, { status: 422 }));
    await expect(postSpeechSay("x")).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps 422 GUARD_BLOCKED to GuardBlockedError carrying only the rule", async () => {
    captureSay(() => HttpResponse.json({ detail: { error: "GUARD_BLOCKED", rule: "R9" } }, { status: 422 }));
    const err = await postSpeechSay("secret words").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GuardBlockedError);
    expect((err as GuardBlockedError).rule).toBe("R9");
    expect((err as Error).message).not.toContain("secret");
  });

  it("maps 503 to SpeechUnavailableError", async () => {
    captureSay(() => HttpResponse.json({ detail: { error: "SPEECH_UNAVAILABLE" } }, { status: 503 }));
    const err = await postSpeechSay("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpeechUnavailableError);
    expect((err as ApiError).status).toBe(503);
  });

  it("maps other failures to ApiError", async () => {
    captureSay(() => HttpResponse.json({}, { status: 500 }));
    const err = await postSpeechSay("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  it("stop / pause / resume hit their endpoints", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/speech/stop`, () => HttpResponse.json({ discarded: 3 })),
      http.post(`${API_BASE_URL}/api/speech/pause`, () => HttpResponse.json({ paused: true })),
      http.post(`${API_BASE_URL}/api/speech/resume`, () => HttpResponse.json({ paused: false }))
    );
    await expect(postSpeechStop()).resolves.toEqual({ discarded: 3 });
    await expect(postSpeechPause()).resolves.toEqual({ paused: true });
    await expect(postSpeechResume()).resolves.toEqual({ paused: false });
  });

  it("pause maps 503 to SpeechUnavailableError", async () => {
    server.use(http.post(`${API_BASE_URL}/api/speech/pause`, () => HttpResponse.json({ detail: {} }, { status: 503 })));
    await expect(postSpeechPause()).rejects.toBeInstanceOf(SpeechUnavailableError);
  });

  it("getSpeechState returns the state payload", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/speech/state`, () =>
        HttpResponse.json({ paused: true, readaloud_active: false, readaloud_pending: 2 })
      )
    );
    await expect(getSpeechState()).resolves.toEqual({ paused: true, readaloud_active: false, readaloud_pending: 2 });
  });
});
