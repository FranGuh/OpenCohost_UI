import type {
  AgendaResponse,
  AgendaSessionAction,
  AgendaSessionRequest,
  AgendaTopicRequest,
  CohostProfileSaveRequest
} from "../../api/agenda.js";
import { ApiError, ConflictError, ValidationError } from "../../api/client.js";
import type { MusicMoodResponse } from "../../api/music.js";
import type { StreamChatLiveResponse, StreamLimitsRequest } from "../../api/stream.js";
import { StreamConnectTimeoutError } from "../../api/stream.js";
import { t, type TKey } from "../../i18n/t.js";
import type { StepValue } from "./primitives.js";

/**
 * Pure command-wiring helpers (D5/D13). Everything that maps a stepper's UI
 * values to a backend request body, or a response/error to operator-facing
 * voseo copy, lives here so it is unit-testable in isolation and the registry
 * stays declarative. No React, no fetch — pure functions + const tables.
 */

/**
 * One descriptor per closed UI vocabulary (F6): pairs the UI `value`/`label`
 * the registry's Select options (and, for `badgeTone`, its live-agenda
 * badges) need with the `wire` value the backend expects. The registry
 * derives its `options`/badge tables from these; `wireMap` derives the
 * `*_WIRE` lookup used by the `to*Request` builders below — one array per
 * vocab, never two hand-kept copies that can drift.
 */
export interface VocabEntry {
  /** UI value — also the StepOption `value` and the wire lookup key. */
  value: string;
  /** UI label — the StepOption `label`. */
  label: string;
  /** Value sent to the backend for this UI value. */
  wire: string;
}

function wireMap(vocab: readonly VocabEntry[]): Record<string, string> {
  return Object.fromEntries(vocab.map((entry) => [entry.value, entry.wire]));
}

/** Known 422 `detail` codes the wired command endpoints can send back (R20's
 * `invalid_url`, R25's `invalid_filter_policy`, Lote C's `unsupported_platform`
 * and the client-side `youtube_channel_url` fast-fail). Everything else is an
 * untranslated backend string (validation sentences, unmapped codes) that
 * must never render verbatim in operator-facing copy. */
const VALIDATION_COPY_KEY: Record<string, TKey> = {
  invalid_url: "commands.action.error.invalid_url",
  invalid_filter_policy: "commands.action.error.invalid_filter_policy",
  unsupported_platform: "commands.action.error.unsupported_platform",
  youtube_channel_url: "commands.action.error.youtube_channel_url"
};

/** Known 503 `detail` codes for the stream connect path (Lote C). An unknown
 * 503 code falls back to the generic service-unavailable line — the raw code
 * never renders (F4). */
const STREAM_UNAVAILABLE_COPY_KEY: Record<string, TKey> = {
  chat_source_unavailable: "commands.action.error.chat_source_unavailable"
};

/**
 * Maps a thrown `api/*` error to voseo operator copy. Order matters: the
 * typed subclasses (`ValidationError`/`ConflictError`) extend `ApiError`, so
 * they must be checked before the generic `ApiError` branch. Anything else
 * (network failure, unknown throw) falls back to a generic retryable line.
 * Only KNOWN codes (`VALIDATION_COPY`) or a numeric status ever reach the
 * operator — raw backend detail text is never interpolated (F4).
 */
export function errorCopy(err: unknown): string {
  // Lote C: a connect that never reported connected within the poll budget.
  if (err instanceof StreamConnectTimeoutError) {
    return t("commands.action.error.timeout");
  }
  if (err instanceof ValidationError) {
    const key = VALIDATION_COPY_KEY[err.message];
    return key ? t(key) : t("commands.action.error.validation");
  }
  if (err instanceof ConflictError) {
    return t("commands.action.error.conflict");
  }
  if (err instanceof ApiError && err.status === 503) {
    // KNOWN 503 codes (e.g. chat_source_unavailable) name the real cause; an
    // unknown 503 detail falls back to the generic line — never the raw code.
    const key = STREAM_UNAVAILABLE_COPY_KEY[err.message];
    return key ? t(key) : t("commands.action.error.unavailable");
  }
  if (err instanceof ApiError) {
    return t("commands.action.error.status", { status: err.status });
  }
  return t("commands.action.error.network");
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
    ? t("commands.acciones.limits.applied")
    : t("commands.acciones.limits.saved");
}

// ─── /agenda → POST /api/agenda/topic (R12-R15, R33-R35) ─────────────────────

/** `prioridad` UI vocab → wire `priority` (R33) + the /temas badge tone.
 * Identity for the current closed UI vocab (`alta/normal/baja`). R33's table
 * lists a "Media"→`normal` label the owner has NOT signed off on; the
 * registry still emits `normal`, so this stays identity (conservative) until
 * that sign-off lands — sending a raw out-of-vocab value would silently
 * normalize to `normal` server-side anyway. */
export const PRIORITY_VOCAB: readonly (VocabEntry & { badgeTone: "ok" | "info" | "warn" })[] = [
  { value: "baja", label: "Baja", wire: "baja", badgeTone: "ok" },
  { value: "normal", label: "Normal", wire: "normal", badgeTone: "info" },
  { value: "alta", label: "Alta", wire: "alta", badgeTone: "warn" }
];
export const PRIORITY_WIRE: Record<string, string> = wireMap(PRIORITY_VOCAB);

/** `largo` UI vocab → wire `response_length` (R34). `corto`→`corta`,
 * `profundo`→`expandida` are the verified backend values. The old mock's
 * `extendido` was a latent defect (not a valid alias); WU7 migrated the UI
 * value to `profundo`, so this covers the three live values only. */
export const LENGTH_VOCAB: readonly VocabEntry[] = [
  { value: "corto", label: "Corto", wire: "corta" },
  { value: "normal", label: "Normal", wire: "normal" },
  { value: "profundo", label: "Profundo", wire: "expandida" }
];
export const LENGTH_WIRE: Record<string, string> = wireMap(LENGTH_VOCAB);

/** Builds the `POST /api/agenda/topic` body from the /agenda stepper values
 * (R12-R14, R33-R35). Etiquetas map 1:1 to `constraints` in entry order, capped
 * at 24 (server enforces the same `_AGENDA_CONSTRAINTS_RAW_MAX`). An empty
 * optional angle is omitted rather than sent blank. */
export function toAgendaTopicRequest(values: Record<string, StepValue>): AgendaTopicRequest {
  const title = ((values.tema as string | undefined) ?? "").trim();
  const angle = ((values.angulo as string | undefined) ?? "").trim();
  const etiquetas = ((values.etiquetas as string[] | undefined) ?? []).slice(0, 24);
  return {
    title,
    ...(angle ? { angle } : {}),
    priority: PRIORITY_WIRE[values.prioridad as string] ?? "normal",
    response_length: LENGTH_WIRE[values.largo as string] ?? "normal",
    constraints: etiquetas
  };
}

// ─── /vivo → POST /api/stream/chat-live/connect (R20/R21) ────────────────────

/** Composes the single `url` string /vivo sends to `postStreamConnect` (R20).
 * `plataforma` is UI-only and never sent as a field. A value that already reads
 * as a URL (or a bare 11-char YouTube id) passes through so the backend's
 * `parse_chat_url` can infer the platform; otherwise a minimal per-platform URL
 * is built from the accepted shapes in `smart_aggregator/url_parser.py`. */
export function composeStreamUrl(plataforma: string, canal: string): string {
  const trimmed = canal.trim();
  if (/^https?:\/\//i.test(trimmed) || /youtube\.com|youtu\.be|twitch\.tv/i.test(trimmed)) {
    return trimmed;
  }
  if (plataforma === "twitch") return `twitch.tv/${trimmed}`;
  // youtube: parse_chat_url accepts a bare 11-char id; otherwise best-effort watch URL.
  return /^[\w-]{11}$/.test(trimmed) ? trimmed : `youtube.com/watch?v=${trimmed}`;
}

/** Lote C fast-fail: a YouTube CHANNEL URL (@handle, /channel/, /c/, /user/)
 * can never yield a live-video chat id — the backend's `parse_chat_url` would
 * 422 it. Detect it BEFORE the POST so /vivo can tell the operator to paste the
 * live VIDEO link instead of round-tripping to a generic invalid_url. A real
 * `watch?v=` / `live/` video URL is NOT a channel URL and passes through. */
export function isYoutubeChannelUrl(canal: string): boolean {
  return /youtube\.com\/(@|channel\/|c\/|user\/)/i.test(canal.trim());
}

/** Ack for /vivo (R21, Lote C). Only reached with a `connected:true` response —
 * the /vivo submit polls status until connected or throws (timeout/422/409/503,
 * all surfaced by `errorCopy`), so this never has to fake a false connect. */
export function describeConnect(response: StreamChatLiveResponse): string {
  const platform = response.platform ?? t("commands.vivo.defaultPlatform");
  return t("commands.vivo.connected", { platform });
}

// ─── /sesion → POST /api/agenda/session/action (R27/R28) ─────────────────────

/** Ack for /sesion actions (R28). A refused `enable` (`applied:false` + reason)
 * is reported honestly — never as success; otherwise a short per-action
 * confirmation. The action is passed in because the AgendaResponse does not
 * echo which verb was dispatched. */
export function describeSessionAction(action: AgendaSessionAction, response: AgendaResponse): string {
  if (response.applied === false) {
    if (response.reason === "empty_queue") {
      return t("commands.sesion.error.empty_queue");
    }
    if (response.reason === "guardrails_missing") {
      return t("commands.sesion.error.guardrails_missing");
    }
    // Unknown refusal reason — never interpolate the raw backend code (F4).
    return t("commands.sesion.error.refused");
  }
  switch (action) {
    case "soft_stop":
      return t("commands.sesion.action.paused");
    case "emergency_stop":
      return t("commands.sesion.action.emergencyApplied");
    default:
      return t("commands.sesion.action.activated");
  }
}

// ─── /perfil → cohost profile save + session update (R16-R19) ────────────────

/**
 * `modo` UI vocab → session `safety_mode` (R19, FLAGGED — owner sign-off
 * pending). `estandar` has no backend wire value or alias, so sending it raw
 * would silently fall back to `live_safe`. This maps it to `monologue` (closest
 * semantic: a less-capped, non-live-safe mode) per the spec's flagged R19
 * assumption. See spec.md R19: only the FINAL target value is in question — the
 * rule that `estandar` must never be sent raw is not.
 */
export const SAFETY_VOCAB: readonly VocabEntry[] = [
  { value: "live_safe", label: "Live-safe", wire: "live_safe" },
  { value: "estandar", label: "Estándar", wire: "monologue" }
];
export const SAFETY_WIRE: Record<string, string> = wireMap(SAFETY_VOCAB);

/** Builds the `POST /api/agenda/cohost-profiles` body (R16) — the cohost
 * IDENTITY, never the LLM persona (`POST /api/perfiles`). */
export function toCohostProfileRequest(values: Record<string, StepValue>): CohostProfileSaveRequest {
  return {
    name: ((values.nombre as string | undefined) ?? "").trim(),
    style: ((values.estilo as string | undefined) ?? "").trim()
  };
}

/** Builds the `PUT /api/agenda/session` body (R17) — `turnos` cast to int,
 * `safety_mode` mapped via SAFETY_WIRE (R19), `rhythm` passed through (already a
 * canonical/alias value). */
export function toAgendaSessionRequest(values: Record<string, StepValue>): AgendaSessionRequest {
  return {
    max_turns_per_topic: Number.parseInt(values.turnos as string, 10),
    safety_mode: SAFETY_WIRE[values.modo as string] ?? "live_safe",
    rhythm: values.ritmo as string
  };
}

// ─── /musica → POST /api/music/mood (R30/R31) ───────────────────────────────

/** Ack for /musica mood selection (R30). Honestly surfaces a `fallback:true`
 * response (the requested mood had no tracks of its own, so the backend served
 * its normal/any pool) rather than claiming the requested mood is active. */
export function describeMood(response: MusicMoodResponse): string {
  if (response.fallback) {
    return t("commands.musica.mood.fallback", { mood: response.active_mood });
  }
  return t("commands.musica.mood.active", { mood: response.active_mood });
}
