import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client.js";
import { t } from "../../i18n/t.js";
import { keyTestOutcome, testErrorToResponse } from "./keyTestOutcome.js";

const base = { ok: true, error_code: null, models: ["a", "b"], recommended: [] };

describe("keyTestOutcome", () => {
  it("passes when the key works and the model answers", () => {
    const out = keyTestOutcome({ ...base, chat_ok: true }, t);
    expect(out).toEqual({ kind: "pass", line: "¡Listo! Tu API key funciona y el modelo responde.", detail: null });
  });

  it("falls back to the model count when the chat stage did not run", () => {
    const out = keyTestOutcome({ ...base, chat_ok: null }, t);
    expect(out).toEqual({ kind: "keyOnly", line: "Key válida: 2 modelos disponibles", detail: null });
  });

  it.each([
    ["cloud_auth", 403, "La key es válida, pero el proveedor no deja usarla con este modelo."],
    ["cloud_rate_limit", 402, "La key es válida, pero no hay saldo o llegaste al límite del proveedor."],
    ["cloud_bad_request", 404, "La key es válida, pero el modelo no está disponible o rechazó la petición."],
    ["timeout", null, "La key es válida, pero el modelo tardó demasiado en responder."],
    ["cloud_error", 500, "La key es válida, pero el proveedor falló al responder."]
  ] as const)("explains a failed chat stage (%s)", (code, status, line) => {
    const out = keyTestOutcome(
      { ...base, chat_ok: false, chat_error_code: code, http_status: status, provider_message: status ? "Boom" : null },
      t
    );
    expect(out.kind).toBe("chatFail");
    expect(out.line).toBe(line);
    expect(out.detail).toBe(status ? `HTTP ${status}: Boom` : null);
  });

  it("omits the trailing colon when the provider sent no message", () => {
    const out = keyTestOutcome(
      { ...base, chat_ok: false, chat_error_code: "cloud_error", http_status: 500, provider_message: null },
      t
    );
    expect(out.detail).toBe("HTTP 500");
  });

  it("reports a key failure from stage 1 with its detail", () => {
    const out = keyTestOutcome(
      { ok: false, error_code: "invalid_key", models: [], recommended: [], http_status: 401 },
      t
    );
    expect(out.kind).toBe("keyFail");
    expect(out.line).toBe("La key no es válida. Revisa que la copiaste completa.");
    expect(out.detail).toBe("HTTP 401");
  });

  it("surfaces provider_message as detail even when http_status is null", () => {
    const out = keyTestOutcome(
      { ok: false, error_code: "unreachable", models: [], recommended: [], http_status: null, provider_message: "Connection timed out" },
      t
    );
    expect(out.kind).toBe("keyFail");
    expect(out.detail).toBe("Connection timed out");
  });

  it("converts ApiError and TimeoutError into actionable LlmProviderTestResponse shapes", () => {
    const apiErr = testErrorToResponse(new ApiError("Gateway Timeout", 504), t);
    expect(apiErr).toMatchObject({ ok: false, error_code: "unreachable", http_status: 504, provider_message: "Gateway Timeout" });

    const authErr = testErrorToResponse(new ApiError("Unauthorized", 401), t);
    expect(authErr).toMatchObject({ ok: false, error_code: "invalid_key", http_status: 401, provider_message: "Unauthorized" });

    const timeoutErr = testErrorToResponse(new DOMException("Timed out", "TimeoutError"), t);
    expect(timeoutErr).toMatchObject({ ok: false, error_code: "unreachable", http_status: null });
    expect(timeoutErr.provider_message).toMatch(/Tiempo de espera agotado/i);
  });
});
