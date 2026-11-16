import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError } from "./client.js";
import { GuardrailsValidationError, getGuardrails, putGuardrails } from "./guardrails.js";

const RULES = [
  { id: "no_hate_speech", tier: "locked", category: "safety", enabled: true },
  { id: "no_ai_self_identification", tier: "toggleable", category: "persona", enabled: false }
];

describe("guardrails client", () => {
  it("getGuardrails returns the rules array shape", async () => {
    server.use(http.get(`${API_BASE_URL}/api/guardrails`, () => HttpResponse.json({ rules: RULES })));
    expect((await getGuardrails()).rules).toEqual(RULES);
  });

  it("putGuardrails sends the full disabled list and returns the saved rules", async () => {
    let body: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/guardrails`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ rules: RULES });
      })
    );
    const saved = await putGuardrails(["no_ai_self_identification"]);
    expect(body).toEqual({ disabled: ["no_ai_self_identification"] });
    expect(saved.rules).toEqual(RULES);
  });

  it("maps a 422 to a typed validation error carrying per-id codes", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/guardrails`, () =>
        HttpResponse.json(
          { detail: "invalid_guardrails", errors: [{ id: "no_hate_speech", code: "locked" }] },
          { status: 422 }
        )
      )
    );
    const err = await putGuardrails(["no_hate_speech"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GuardrailsValidationError);
    expect((err as GuardrailsValidationError).errors).toEqual([{ id: "no_hate_speech", code: "locked" }]);
  });

  it("maps a non-JSON 422 to a validation error with no detail", async () => {
    server.use(http.put(`${API_BASE_URL}/api/guardrails`, () => new HttpResponse("nope", { status: 422 })));
    const err = await putGuardrails([]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GuardrailsValidationError);
    expect((err as GuardrailsValidationError).errors).toEqual([]);
  });

  it("maps a 503 to an ApiError carrying the status", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/guardrails`, () =>
        HttpResponse.json({ detail: "guardrails_write_failed" }, { status: 503 })
      )
    );
    const err = await putGuardrails([]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(GuardrailsValidationError);
    expect((err as ApiError).status).toBe(503);
  });

  it("getGuardrails throws an ApiError on failure", async () => {
    server.use(http.get(`${API_BASE_URL}/api/guardrails`, () => new HttpResponse(null, { status: 500 })));
    await expect(getGuardrails()).rejects.toBeInstanceOf(ApiError);
  });
});
