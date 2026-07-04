import type { paths } from "./types.gen.js";

export type StatusResponse = paths["/api/status"]["get"]["responses"][200]["content"]["application/json"];
export type ProfilesResponse = paths["/api/perfiles"]["get"]["responses"][200]["content"]["application/json"];
export type ModelsResponse = paths["/api/models"]["get"]["responses"][200]["content"]["application/json"];
export type TtsConfigResponse = paths["/api/tts/config"]["get"]["responses"][200]["content"]["application/json"];
export type MemoriaStatsResponse = paths["/api/memoria/stats"]["get"]["responses"][200]["content"]["application/json"];

/**
 * `POST /api/perfiles/switch` has no `response_model` on the backend route
 * (opencohost/api/main.py), so openapi-typescript can't infer its 200 shape.
 * Hand-typed from opencohost/api/models.py::SwitchProfileResponse.
 * ponytail: keep this in sync manually if that model changes.
 */
export interface SwitchAccepted {
  accepted: true;
  command_id: string;
  status: string;
}

/**
 * `POST /api/commands` also has no `response_model` (main.py returns a raw
 * dict) — same hand-typed pattern as SwitchAccepted, from the literal
 * `post_command` return shape. ponytail: keep in sync manually.
 */
export interface CommandAccepted {
  accepted: true;
  command_id: string;
  status: string;
  state_version: number;
}

/**
 * `POST /api/chat/turn` also has no `response_model` — same hand-typed
 * pattern as CommandAccepted. R8: accepted-only, never echoes Kira's reply
 * (audio-only) — do not add a `reply`/`transcript` field here.
 * ponytail: keep in sync manually.
 */
export interface ChatTurnAccepted {
  accepted: true;
  command_id: string;
  status: string;
  state_version: number;
}

/** Server-side whitelist mirrored from opencohost/api/main.py::_COMMAND_WHITELIST. */
export type EngineCommand =
  | "clear_history"
  | "set_tts_local_only"
  | "set_tts_speed"
  | "set_piper_voice"
  | "set_motor_tts"
  | "switch_model"
  | "switch_llm_tier";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class ConflictError extends ApiError {
  constructor(message = "profile switch conflict") {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export class QueueFullError extends ApiError {
  constructor(message = "command queue full") {
    super(message, 429);
    this.name = "QueueFullError";
  }
}

export class NotFoundError extends ApiError {
  constructor(detail: string) {
    super(detail, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends ApiError {
  constructor(detail: string) {
    super(detail, 422);
    this.name = "ValidationError";
  }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

/**
 * Design D5: Idempotency-Key is stable per switch INTENT (per target),
 * reused across retries of that intent. Module-scope singleton — shared by
 * the mutation hook (src/api/profiles.ts) and the convergence poll
 * (src/api/status.ts) so a key can be rotated on CONVERGENCE, not just on
 * hook mount lifetime. Without rotation, a later re-switch to an
 * already-converged target would replay the completed backend command
 * (same key -> same command_id, no re-enqueue) and get stuck "applying".
 */
const idempotencyKeys = new Map<string, string>();

export function getIdempotencyKey(target: string): string {
  let key = idempotencyKeys.get(target);
  if (!key) {
    key = crypto.randomUUID();
    idempotencyKeys.set(target, key);
  }
  return key;
}

export function rotateIdempotencyKey(target: string): void {
  idempotencyKeys.delete(target);
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch(`${BASE_URL}/api/status`);
  if (!res.ok) {
    throw new ApiError(`GET /api/status failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StatusResponse;
}

export async function getPerfiles(): Promise<ProfilesResponse> {
  const res = await fetch(`${BASE_URL}/api/perfiles`);
  if (!res.ok) {
    throw new ApiError(`GET /api/perfiles failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ProfilesResponse;
}

export async function switchProfile(name: string, idempotencyKey: string): Promise<SwitchAccepted> {
  const res = await fetch(`${BASE_URL}/api/perfiles/switch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ name })
  });

  if (res.status === 409) {
    throw new ConflictError();
  }
  if (res.status === 429) {
    throw new QueueFullError();
  }
  if (res.status === 404) {
    let detail = "profile not found";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // non-JSON 404 body — fall back to a generic message instead of
      // letting res.json() throw an opaque SyntaxError.
    }
    throw new NotFoundError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/perfiles/switch failed with ${res.status}`, res.status);
  }
  const body = (await res.json()) as SwitchAccepted;
  if (!body.accepted) {
    throw new ApiError("POST /api/perfiles/switch returned 200 with accepted:false", res.status);
  }
  return body;
}

export async function getModels(): Promise<ModelsResponse> {
  const res = await fetch(`${BASE_URL}/api/models`);
  if (!res.ok) {
    throw new ApiError(`GET /api/models failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ModelsResponse;
}

export async function getTtsConfig(): Promise<TtsConfigResponse> {
  const res = await fetch(`${BASE_URL}/api/tts/config`);
  if (!res.ok) {
    throw new ApiError(`GET /api/tts/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as TtsConfigResponse;
}

export async function getMemoriaStats(): Promise<MemoriaStatsResponse> {
  const res = await fetch(`${BASE_URL}/api/memoria/stats`);
  if (!res.ok) {
    throw new ApiError(`GET /api/memoria/stats failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaStatsResponse;
}

/**
 * POST /api/commands (spec B2). `value` lands under `payload.value` for
 * every verb except `clear_history`, which takes no value at all —
 * mirrors `_engine_command_payload` (opencohost/api/main.py).
 */
export async function postCommand(
  command: EngineCommand,
  value: unknown,
  idempotencyKey: string
): Promise<CommandAccepted> {
  const payload = command === "clear_history" ? {} : { value };
  const res = await fetch(`${BASE_URL}/api/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ command, payload })
  });

  if (res.status === 409) {
    throw new ConflictError("engine command conflict");
  }
  if (res.status === 429) {
    throw new QueueFullError("engine command queue full");
  }
  if (res.status === 422) {
    let detail = "invalid command";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/commands failed with ${res.status}`, res.status);
  }
  const body = (await res.json()) as CommandAccepted;
  if (!body.accepted) {
    throw new ApiError("POST /api/commands returned 200 with accepted:false", res.status);
  }
  return body;
}

/**
 * POST /api/chat/turn (R8): accepted-only — the response never carries
 * Kira's reply (that's audio-only, observed via is_speaking on the status
 * poll). Same error-mapping shape as postCommand.
 */
export async function postChatTurn(text: string, idempotencyKey: string): Promise<ChatTurnAccepted> {
  const res = await fetch(`${BASE_URL}/api/chat/turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ text })
  });

  if (res.status === 409) {
    throw new ConflictError("chat turn conflict");
  }
  if (res.status === 429) {
    throw new QueueFullError("chat turn queue full");
  }
  if (res.status === 422) {
    let detail = "invalid chat turn";
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/chat/turn failed with ${res.status}`, res.status);
  }
  const body = (await res.json()) as ChatTurnAccepted;
  if (!body.accepted) {
    throw new ApiError("POST /api/chat/turn returned 200 with accepted:false", res.status);
  }
  return body;
}
