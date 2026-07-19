import { ApiError, ConflictError, ValidationError } from "../../api/client.js";
import type { StreamChatLiveResponse, StreamLimitsRequest } from "../../api/stream.js";
import type { StepValue } from "./primitives.js";

/**
 * Pure command-wiring helpers (D5/D13). Everything that maps a stepper's UI
 * values to a backend request body, or a response/error to operator-facing
 * voseo copy, lives here so it is unit-testable in isolation and the registry
 * stays declarative. No React, no fetch — pure functions + const tables.
 */

/**
 * Maps a thrown `api/*` error to voseo operator copy. Order matters: the
 * typed subclasses (`ValidationError`/`ConflictError`) extend `ApiError`, so
 * they must be checked before the generic `ApiError` branch. Anything else
 * (network failure, unknown throw) falls back to a generic retryable line.
 */
export function errorCopy(err: unknown): string {
  if (err instanceof ValidationError) {
    return `No se pudo aplicar: ${err.message}`;
  }
  if (err instanceof ConflictError) {
    return "Ya hay una operación en curso — probá de nuevo en un momento.";
  }
  if (err instanceof ApiError) {
    return `Falló la operación (${err.status}) — probá de nuevo.`;
  }
  return "No se pudo conectar — revisá el backend y probá de nuevo.";
}

// ─── /acciones → PUT /api/stream/chat-live/limits (R22-R26) ──────────────────

/** `reacciones` UI value → `threshold_per_second` (R22). */
export const REACCIONES_WIRE: Record<string, number> = { bajo: 1, medio: 3, alto: 5 };

/** `cooldown` UI value → `cooldown_seconds` (R23). */
export const COOLDOWN_WIRE: Record<string, number> = { bajo: 20, medio: 45, alto: 90 };

/** `input_contract` UI value → `filter_policy` (R25). The 3 verified backend
 * presets; the wire value IS the option value, so this is an identity map that
 * documents the closed vocab and guards against an out-of-set value. */
export const FILTER_POLICY: Record<string, string> = {
  balanced: "balanced",
  twitch_relaxed: "twitch_relaxed",
  strict: "strict"
};

/** Builds the `PUT /api/stream/chat-live/limits` body from the /acciones
 * stepper values (R22-R25). `spam` is a numeric string cast client-side. */
export function toStreamLimits(values: Record<string, StepValue>): StreamLimitsRequest {
  return {
    threshold_per_second: REACCIONES_WIRE[values.reacciones as string],
    cooldown_seconds: COOLDOWN_WIRE[values.cooldown as string],
    max_messages_per_user: Number.parseInt(values.spam as string, 10),
    filter_policy: FILTER_POLICY[values.input_contract as string]
  };
}

/**
 * Ack copy for /acciones (R26). The payload and endpoint are identical whether
 * or not the chat-live link is connected — only the wording differs. Reads the
 * PUT response's own `connected` field (no second GET round-trip).
 */
export function describeStreamLimits(response: StreamChatLiveResponse): string {
  return response.connected
    ? "Listo — se aplicó al chat en vivo conectado."
    : "Guardado — se va a usar la próxima vez que conectes el chat en vivo.";
}
