import type { components, paths } from "./types.gen.js";

type GeneratedStatusResponse = paths["/api/status"]["get"]["responses"][200]["content"]["application/json"];

/**
 * `ollama_warming` mirrors opencohost/api/models.py::StatusResponse.ollama_warming
 * (added for S4/P2). types.gen.ts is generated from openapi.snapshot.json, which
 * hasn't been regenerated against a live server since the field landed, so it's
 * hand-added here the same way LastReplyResponse below is hand-typed.
 * ponytail: keep in sync manually until the snapshot is regenerated.
 */
export type StatusResponse = GeneratedStatusResponse & {
  ollama_warming?: boolean;
  // F4: coarse avatar/pipeline state derived by the backend /api/status
  // handler (opencohost/api/models.py::StatusResponse.avatar_state). Hand-added
  // for the same snapshot-lag reason as ollama_warming above.
  avatar_state?: string;
  // Stable profile UUID mirrored from MotorVocalIA._current_profile_id
  // (opencohost/api/models.py::StatusResponse.active_profile_id). `active_profile`
  // is a display NAME — memoria rows are stored keyed by this uuid, not the
  // name, so any /api/memoria/* call must use this field. `null`/absent
  // until the engine applies its first profile switch. Hand-added for the
  // same snapshot-lag reason as ollama_warming above.
  // ponytail: keep in sync manually.
  active_profile_id?: string | null;
  // Provider truth (runtime_findings_batch_20260731 F4/1.3), mirrors
  // opencohost/api/models.py::StatusResponse.provider/.transport/.fallback_active
  // — the engine's LIVE effective posture, never the persisted llm_provider.json.
  // Hand-added for the same snapshot-lag reason as ollama_warming above.
  // ponytail: keep in sync manually until the snapshot is regenerated.
  provider?: string;
  transport?: string;
  fallback_active?: boolean;
  // cloud_rearm_20260801 WU5: closes the runtime_findings_batch_20260731 §1b
  // gap — these two fields have existed backend-side since unit 2.2 but were
  // never added to the front's StatusResponse mirror until now. `fallback_reason`
  // is the failure_class string (ambiguous_429/bad_key/rate_limited/transient);
  // `next_cloud_probe_in_seconds` drives StatusRail's fallback-chip countdown,
  // refreshed for free by the existing ~2s status poll. Hand-added for the
  // same snapshot-lag reason as ollama_warming above.
  // ponytail: keep in sync manually until the snapshot is regenerated.
  fallback_reason?: string | null;
  next_cloud_probe_in_seconds?: number | null;
  // Unit 2.5 (runtime_findings_batch_20260731 F13), mirrors
  // opencohost/api/models.py::StatusResponse.session_mode/.llm_generating/
  // .pending_commands_count — session_mode is DERIVED backend-side from the
  // agenda state + these booleans, never a second stored source of truth.
  // Hand-added for the same snapshot-lag reason as ollama_warming above.
  // ponytail: keep in sync manually until the snapshot is regenerated.
  session_mode?: "agenda" | "post-agenda" | "inactiva";
  llm_generating?: boolean;
  pending_commands_count?: number;
  // Unit 2.3/2.5: mirrors opencohost/api/models.py::StatusResponse.ctx_telemetry
  // / CtxTelemetryOut — None before the first generation of the process.
  ctx_telemetry?: {
    ratio: number;
    effective_ctx: number;
    native_ctx: number;
    evicted_pairs: number;
    source: string;
  } | null;
  // Resource numbers (runtime_findings_batch_20260731 F9/F14/2.4): total/used
  // VRAM come from the same nvmlDeviceGetMemoryInfo() call as free_vram_mb;
  // model_*_est come from ollama.ps() (size/size_vram) — Ollama's OWN
  // ESTIMATE of the model's memory split, never process RSS. Mirrors
  // opencohost/api/models.py::HealthState's new fields. Hand-added for the
  // same snapshot-lag reason as ollama_warming above.
  // ponytail: keep in sync manually until the snapshot is regenerated.
  health: GeneratedStatusResponse["health"] & {
    total_vram_mb?: number;
    used_vram_mb?: number;
    model_resident_mb_est?: number | null;
    model_vram_mb_est?: number | null;
    model_ram_spill_mb_est?: number | null;
    model_processor_split?: string | null;
  };
};
export type ProfilesResponse = paths["/api/perfiles"]["get"]["responses"][200]["content"]["application/json"];

/**
 * Mirrors opencohost/api/models.py::ModelReasoningConfig (T2,
 * controls-cleanup-adaptive-reasoning-20260928). `budget_tokens: null` means
 * Auto -- the adaptive budget engine decides the generation budget at
 * request time from calibrated throughput/latency targets. A number is a
 * REAL manual cap on that adaptive estimate (min(), never a floor or
 * override) -- see `resolve_generation_budget` in
 * opencohost/core/engine/llm_budget_engine.py.
 */
export interface ModelReasoningConfig {
  enabled: boolean;
  budget_tokens: number | null;
}

/**
 * Mirrors opencohost/api/models.py::ModelContextConfig (T2,
 * model-context-auto-config-20260928). Describes the CURRENT/active model
 * only — same single-model shape as ModelReasoningConfig above, not a
 * per-installed-model dict (owner decision 2026-09-28).
 * `native_context`/`effective_context` are read-only best-effort and degrade
 * to `null` when not yet cached backend-side.
 */
export interface ModelContextConfig {
  model: string;
  context_tokens: number | null;
  auto_context_tokens: number;
  native_context: number | null;
  effective_context: number | null;
  policy: string;
}

export type ModelsResponse = paths["/api/models"]["get"]["responses"][200]["content"]["application/json"] & {
  is_reasoning_active?: boolean;
  reasoning_config?: ModelReasoningConfig;
  context_config?: ModelContextConfig;
};

export type LlmReadinessState =
  | "LOCAL_READY"
  | "LOCAL_OLLAMA_MISSING"
  | "LOCAL_OLLAMA_OFFLINE"
  | "LOCAL_NO_MODELS"
  | "LOCAL_MODEL_MISSING"
  | "CLOUD_READY"
  | "CLOUD_UNCONFIGURED"
  | "CLOUD_VALIDATING"
  | "CLOUD_INVALID_CREDENTIALS"
  | "CLOUD_UNREACHABLE";

export type LlmReadinessResponse = {
  state: LlmReadinessState | string;
  provider: "local" | "cloud" | string;
  can_chat: boolean;
  selected_model?: string | null;
  ollama: {
    reachable: boolean;
    installed_models: string[];
    selected_model?: string | null;
    model_installed?: boolean;
    error?: string | null;
    binary_found?: boolean;
    binary_path?: string | null;
    in_path?: boolean;
  };
  cloud: {
    configured: boolean;
    validating?: boolean;
    selected_model?: string | null;
    error?: string | null;
    endpoint?: string;
    provider_id?: string | null;
    reachable?: boolean | null;
  };
  hardware: {
    gpu_name?: string | null;
    total_vram_mb?: number | null;
    free_vram_mb?: number | null;
    recommended_tier: string;
    recommended_model: string;
    /** True when no GPU was detected (VRAM 0 / detection failure). Newer than older backends. */
    cpu_only?: boolean;
    /** Backend hardware recommendation (llm_readiness.get_hardware_guideline). */
    recommended_tag?: string;
  };
};
type GeneratedTtsConfigResponse = paths["/api/tts/config"]["get"]["responses"][200]["content"]["application/json"];
export type TtsConfigResponse = GeneratedTtsConfigResponse & {
  piper_available?: boolean;
  /** Why Piper is unavailable; newer than older backends. */
  piper_unavailable_reason?: "package_missing" | "voice_file_missing" | null;
  edge_tts_offline?: boolean;
  discard_speech_residue?: boolean;
  /** Catalog id (filename) of the effective Piper voice; `piper_voice` may hold the same id. */
  piper_voice_id?: string | null;
  piper_speaker_id?: number | null;
  /** Why the last Piper switch failed; null/absent when none did. */
  piper_switch_failure_reason?: string | null;
  /** Effective Edge-TTS voice for the active locale. */
  edge_voice?: string | null;
  edge_voice_failure_reason?: string | null;
};

/** `set_piper_voice` value when a speaker is chosen (sent as `{value, speaker_id}`). */
export interface PiperVoiceCommandValue {
  value: string;
  speaker_id?: number;
}
type GeneratedMemoriaStatsResponse = paths["/api/memoria/stats"]["get"]["responses"][200]["content"]["application/json"];
/**
 * FIX-A: `saved_memorias`/`pinned` are per-profile counts when the request
 * carries `profile_id` (so the MemoryCard headline agrees with the per-profile
 * list); `saved_memorias_total`/`pinned_total` carry the global figures. Both
 * total fields mirror opencohost/api/models.py::MemoriaStatsResponse but are
 * hand-added here because types.gen.ts predates them (same snapshot-lag pattern
 * as StatusResponse.ollama_warming above). ponytail: keep in sync manually.
 */
export type MemoriaStatsResponse = GeneratedMemoriaStatsResponse & {
  saved_memorias_total?: number;
  pinned_total?: number;
};

/**
 * `GET /api/memoria/list` and `POST /api/memoria/purge` (F5) — not in
 * types.gen.ts yet (snapshot lag, same reason as ollama_warming above).
 * Hand-typed from opencohost/api/models.py::MemoriaListResponse /
 * MemoriaPurgeResponse. R8: `content` stays excluded from the list — it is
 * only readable one row at a time via GET /api/memoria/row/{id} (see
 * src/api/memoria.ts::getMemoriaRow).
 * ponytail: keep in sync manually until the snapshot is regenerated.
 */
// MIGRATED to the generated schema (2026-08-14). This was hand-typed while
// openapi.snapshot.json sat six weeks stale, and it had already drifted: the
// backend computes and sends `promoted` (true when the promotion judge kept
// the row) on every response, and this interface did not know the field
// existed — so the Memoria panel could not tell a judge-approved memory from
// an unjudged draft. R8 is unaffected: `content` is still absent from the LIST
// projection server-side, readable one row at a time via
// GET /api/memoria/row/{id} (see src/api/memoria.ts::getMemoriaRow).
export type MemoriaListItem = components["schemas"]["MemoriaListItem"];
export interface MemoriaListResponse {
  items: MemoriaListItem[];
}
export interface MemoriaPurgeResponse {
  deleted: number;
}

/**
 * `GET /api/memoria/row/{id}` (WU-H, operator viewing decision, 2026-07-05)
 * — not in types.gen.ts yet. Hand-typed from
 * opencohost/api/models.py::MemoriaRowResponse. The ONLY memoria response
 * that carries `content` — fetched on-demand, one row at a time, never
 * preloaded alongside MemoriaListResponse.
 * ponytail: keep in sync manually until the snapshot is regenerated.
 */
// MIGRATED to the generated schema (2026-08-14), same drift as
// MemoriaListItem above: `promoted` was missing here too.
export type MemoriaRowResponse = components["schemas"]["MemoriaRowResponse"];

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

/**
 * `GET /api/chat/last-reply` declares `response_model=ChatLastReplyResponse`
 * on the backend (opencohost/api/main.py), but types.gen.ts is generated from
 * openapi.snapshot.json, which hasn't been regenerated since that model
 * landed — hand-typed here from opencohost/api/models.py::ChatLastReplyResponse
 * until the snapshot is refreshed.
 * `text === null` means no reply has landed yet (R8: only Kira's own
 * generated reply text is ever surfaced here, never raw viewer chat).
 * Unit 4.2 (runtime_findings_batch_20260731, D3b/F12): queue_wait_ms and the
 * four provider-disclosure fields are all null for a turn with no
 * submitted_under_provider tag (agenda, accumulated, or any reply recorded
 * before this unit) — never a fabricated value.
 * `origin` (tauri_stream_chat_20260812 follow-up): the true generating
 * source, currently only distinguishing `"chat"` (a reply to VIEWER chat —
 * routed to the Stream chat tab, kept OUT of the Chat tab) from everything
 * else. Missing/null is the safe default and means "not a stream reply" —
 * preserves prior behavior (Chat tab) for any caller/backend that hasn't
 * been updated yet.
 * ponytail: keep in sync manually.
 */
export interface LastReplyResponse {
  text: string | null;
  source: string | null;
  turn_id: number;
  ts: number | null;
  queue_wait_ms?: number | null;
  answered_by_provider?: string | null;
  answered_by_transport?: string | null;
  submitted_under_provider?: string | null;
  provider_changed_while_queued?: boolean | null;
  origin?: string | null;
  fragments?: string[] | null;
  is_streaming?: boolean | null;
  web_searched?: boolean | null;
  /** Real sources of a web answer (runtime-fixes-20261110 T5), built by the
   * backend: at most 3, `https:` only. Hand-typed, like the fields above. */
  web_sources?: WebSource[] | null;
}

/** One source of a web answer. The UI labels the chip from `url`, never `host`. */
export interface WebSource {
  host: string;
  url: string;
}

/**
 * `GET /api/chat/speech-progress`. `turn_id` is a vision-read token and must
 * NOT be used for highlighting; `feed_turn_id` is the reply-feed turn (same id
 * as `turn_id` in `/api/chat/last-reply`), null for read-aloud, vision
 * readings, status lines and notices. `job_id` is monotonic per speech job,
 * `fragment` is the exact TTS fragment playing now (= fragments[current_idx]).
 * The four new fields are always present and nullable on current backends;
 * optional here so older payloads still type-check.
 * ponytail: keep in sync manually.
 */
export interface ChatSpeechProgressResponse {
  speaking: boolean;
  turn_id?: number | null;
  current_idx: number | null;
  played: number;
  total: number;
  feed_turn_id?: number | null;
  job_id?: number | null;
  source?: string | null;
  fragment?: string | null;
}

/** Server-side whitelist mirrored from opencohost/api/main.py::_COMMAND_WHITELIST. */
export type EngineCommand =
  | "clear_history"
  | "set_tts_local_only"
  | "set_tts_speed"
  | "set_piper_voice"
  | "set_edge_voice"
  | "set_motor_tts"
  | "set_discard_speech_residue"
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

/**
 * A pasted-image turn that failed in the vision step. `code` is the backend's
 * stable `vision_*` enum (opencohost/api/chat_image.py), never free text, so the
 * UI can pick a message per cause. The backend queued nothing when this is thrown.
 */
export class ChatImageError extends ApiError {
  readonly code: string;
  /** Which image of the message failed (0-based `index` of `total`), when the
   * backend says so. Counts only, never content. */
  readonly failedImage: { index: number; total: number } | null;
  constructor(code: string, status: number, failedImage: { index: number; total: number } | null = null) {
    super(code, status);
    this.name = "ChatImageError";
    this.code = code;
    this.failedImage = failedImage;
  }
}

async function visionFailure(
  res: Response
): Promise<{ code: string; failedImage: { index: number; total: number } | null } | null> {
  try {
    const body = (await res.clone().json()) as { detail?: unknown; image_index?: unknown; image_total?: unknown };
    if (typeof body.detail !== "string" || !/^vision_[a-z_]+$/.test(body.detail)) return null;
    const failedImage =
      Number.isInteger(body.image_index) && Number.isInteger(body.image_total)
        ? { index: body.image_index as number, total: body.image_total as number }
        : null;
    return { code: body.detail, failedImage };
  } catch {
    return null;
  }
}

/**
 * The real backend (opencohost/api, run via run-api.bat) listens on :8765.
 * VITE_API_BASE_URL (set in .env.local for dev) overrides this, but a
 * packaged build with no .env.local must still reach the real port instead
 * of silently targeting a dead :8000.
 */
export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8765";

let currentBaseUrl: string = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;

/**
 * Current API base URL. Read at call time (not captured at module load) so
 * `setApiBaseUrl` below can redirect every already-imported api/*.ts module
 * without re-importing anything.
 */
export function getApiBaseUrl(): string {
  return currentBaseUrl;
}

/**
 * Overrides the base URL at runtime. Used by the Tauri bootstrap
 * (src/lib/backendBootstrap.ts) once `invoke("backend_info")` resolves the
 * real managed/reused port — a packaged build has no .env.local to bake
 * VITE_API_BASE_URL into the bundle at build time, so the port is only known
 * after the Rust side spawns (or finds) the backend.
 */
export function setApiBaseUrl(url: string): void {
  currentBaseUrl = url;
}

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

/**
 * Operator token handoff (agent_context_gateway Phase 4, design ADR-5). The
 * cache is populated by `bootstrapApiToken()` (called once from
 * `src/lib/backendBootstrap.ts` at startup) and refreshed by `authFetch` on
 * a 401. `null` — the default, and the only possible state outside the
 * Tauri shell — means every mutating request goes out with no Authorization
 * header (enforced by default since 2026-11-08, so the backend answers 401;
 * the kill switch OPENCOHOST_API_AUTH=0 restores the old behavior).
 */
let cachedApiToken: string | null = null;
let tokenFetchPromise: Promise<string | null> | null = null;

/** Test/advanced override — same pattern as `setApiBaseUrl`. Production
 * code never calls this directly. */
export function setApiToken(token: string | null): void {
  cachedApiToken = token;
}

export function getAuthHeaders(): Record<string, string> {
  return cachedApiToken ? { Authorization: `Bearer ${cachedApiToken}` } : {};
}

/**
 * Fetches (once — concurrent callers share the same in-flight request) and
 * caches the operator bearer token via the Tauri `api_token` command
 * (backend.rs, ADR-5). Outside the Tauri shell (`__TAURI_INTERNALS__`
 * absent — plain browser dev) this is a no-op: the cache stays `null`.
 * Never throws — a failed/missing command just leaves the cache empty.
 */
async function refreshApiToken(): Promise<string | null> {
  if (!("__TAURI_INTERNALS__" in window)) {
    cachedApiToken = null;
    return null;
  }
  if (!tokenFetchPromise) {
    tokenFetchPromise = (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string | null>("api_token");
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("client: api_token invoke failed, continuing without a token", error);
        return null;
      } finally {
        tokenFetchPromise = null;
      }
    })();
  }
  cachedApiToken = await tokenFetchPromise;
  return cachedApiToken;
}

/** Called once at startup (src/lib/backendBootstrap.ts) to seed the cached
 * operator token before any mutating call goes out. */
export async function bootstrapApiToken(): Promise<void> {
  await refreshApiToken();
}

function withAuthHeaders(init: RequestInit): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...getAuthHeaders() } };
}

/**
 * `fetch` wrapper for mutating calls and sensitive reads (memoria GETs) to operator
 * endpoints — attaches `Authorization: Bearer <token>` when a token is
 * cached, and none otherwise (a missing token must never throw in the
 * call). On a 401 the caller may be racing the spawn-path token mint
 * (design risk "Token file appears AFTER Tauri probes") — refresh the
 * token once and retry the exact same request before handing the response
 * back; a second consecutive 401 (or no token available to retry with) is
 * returned as-is, never looped.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, withAuthHeaders(init));
  if (res.status !== 401) {
    return res;
  }
  const token = await refreshApiToken();
  if (!token) {
    return res;
  }
  return fetch(url, withAuthHeaders(init));
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/status`);
  if (!res.ok) {
    throw new ApiError(`GET /api/status failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StatusResponse;
}

export async function getPerfiles(locale?: string): Promise<ProfilesResponse> {
  const url = locale
    ? `${getApiBaseUrl()}/api/perfiles?locale=${encodeURIComponent(locale)}`
    : `${getApiBaseUrl()}/api/perfiles`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new ApiError(`GET /api/perfiles failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ProfilesResponse;
}

export async function switchProfile(name: string, idempotencyKey: string): Promise<SwitchAccepted> {
  const res = await authFetch(`${getApiBaseUrl()}/api/perfiles/switch`, {
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
  const res = await fetch(`${getApiBaseUrl()}/api/models`);
  if (!res.ok) {
    throw new ApiError(`GET /api/models failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ModelsResponse;
}

/**
 * PUT /api/models/reasoning — `budget_tokens: null` explicitly clears a
 * manual cap back to Auto (mirrors `updateModelContext`'s own
 * null-clears-to-Auto convention). Omitting `budget_tokens` from the call
 * entirely (as `handleToggleReasoning` never does, but a partial caller
 * could) leaves it untouched server-side — the backend distinguishes
 * "omitted" from "explicit null" via the JSON body, not this TS type.
 */
export async function updateModelReasoning(body: {
  enabled?: boolean;
  budget_tokens?: number | null;
  model?: string;
}): Promise<ModelReasoningConfig> {
  const res = await authFetch(`${getApiBaseUrl()}/api/models/reasoning`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`PUT /api/models/reasoning failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ModelReasoningConfig;
}

/**
 * PUT /api/models/context — `context_tokens: null` clears back to Auto.
 * Out-of-range values are silently clamped server-side (2048-131072), never
 * a 422 (T2 contract). Applying to the ACTIVE model triggers a backend
 * reload of that model.
 */
export async function updateModelContext(body: {
  model: string;
  context_tokens: number | null;
}): Promise<ModelContextConfig> {
  const res = await authFetch(`${getApiBaseUrl()}/api/models/context`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`PUT /api/models/context failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ModelContextConfig;
}

export async function getLlmReadiness(): Promise<LlmReadinessResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/llm/readiness`);
  if (!res.ok) {
    throw new ApiError(`GET /api/llm/readiness failed with ${res.status}`, res.status);
  }
  return (await res.json()) as LlmReadinessResponse;
}

export async function getTtsConfig(options: { signal?: AbortSignal } = {}): Promise<TtsConfigResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/tts/config`, { cache: "no-store", signal: options.signal });
  if (!res.ok) {
    throw new ApiError(`GET /api/tts/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as TtsConfigResponse;
}

/**
 * GET /api/memoria/stats. Pass `profileId` to get per-profile
 * `saved_memorias`/`pinned` counts (so the headline agrees with the
 * per-profile GET /api/memoria/list); omit it for global counts. The global
 * totals always come back in `saved_memorias_total`/`pinned_total`.
 */
export async function getMemoriaStats(profileId?: string): Promise<MemoriaStatsResponse> {
  const query = profileId ? `?profile_id=${encodeURIComponent(profileId)}` : "";
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/stats${query}`);
  if (!res.ok) {
    throw new ApiError(`GET /api/memoria/stats failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaStatsResponse;
}

export async function getMemoriaList(profileId: string): Promise<MemoriaListResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/list?profile_id=${encodeURIComponent(profileId)}`);
  if (!res.ok) {
    throw new ApiError(`GET /api/memoria/list failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaListResponse;
}

export async function postMemoriaPurge(profileId: string): Promise<MemoriaPurgeResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/purge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: profileId })
  });
  if (!res.ok) {
    throw new ApiError(`POST /api/memoria/purge failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaPurgeResponse;
}

/**
 * POST /api/commands (spec B2). `value` lands under `payload.value` for
 * every verb except `clear_history`, which takes no value at all —
 * mirrors `_engine_command_payload` (opencohost/api/main.py).
 */
export async function postCommand(
  command: EngineCommand,
  value: unknown,
  idempotencyKey: string,
  options: { signal?: AbortSignal } = {}
): Promise<CommandAccepted> {
  const payload =
    command === "clear_history"
      ? {}
      : command === "set_piper_voice" && typeof value === "object" && value !== null
        ? value
        : { value };
  const res = await authFetch(`${getApiBaseUrl()}/api/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ command, payload }),
    signal: options.signal
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

export async function getLastReply(): Promise<LastReplyResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/chat/last-reply`);
  if (!res.ok) {
    throw new ApiError(`GET /api/chat/last-reply failed with ${res.status}`, res.status);
  }
  return (await res.json()) as LastReplyResponse;
}

/**
 * `GET /api/chat/last-reply?turn_id=N` — same shape, for one of the last 20
 * turns. A 404 (`turn_not_found`: aged out or unknown) resolves to null so the
 * caller simply shows no highlight.
 */
export async function getLastReplyByTurn(turnId: number): Promise<LastReplyResponse | null> {
  const res = await fetch(`${getApiBaseUrl()}/api/chat/last-reply?turn_id=${encodeURIComponent(String(turnId))}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ApiError(`GET /api/chat/last-reply?turn_id failed with ${res.status}`, res.status);
  }
  return (await res.json()) as LastReplyResponse;
}

export async function getSpeechProgress(): Promise<ChatSpeechProgressResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/chat/speech-progress`);
  if (!res.ok) {
    throw new ApiError(`GET /api/chat/speech-progress failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ChatSpeechProgressResponse;
}

/**
 * How long a chat turn may stay in flight before the composer gives up.
 * `/api/chat/turn` is an ENQUEUE endpoint — it returns as soon as the command
 * is accepted, without waiting for Kira to think or speak — so a request still
 * open after this long is a hang, not slow work.
 *
 * Armed here and nowhere else on purpose. Observed 2026-08-10: a turn reached
 * the engine (`[TURN_LATENCY] source=direct queue_wait_ms=31`) while the UI sat
 * with the text still in the input and the Send button permanently greyed,
 * because `handleSubmit` clears only after the POST resolves and opens with
 * `if (pending) return`. Other endpoints have no such logged incident, and some
 * of them (model pulls, TTS synthesis) are legitimately slow — a blanket
 * timeout in `fetch` would break those to defend a path they never broke on.
 */
const CHAT_TURN_TIMEOUT_MS = 15_000;
// An image turn is described BEFORE it is queued: one cold start of the vision
// stack (waited once, opencohost/core/vision/controller.py DEFAULT_COLD_START_WAIT_S
// = 40 s) plus one describe call per image at the largest deadline the setting
// allows (30 s), plus 10 s of margin. One image: 10 + 40 + 30 = 80 s (as in T3).
const CHAT_IMAGE_MARGIN_MS = 10_000;
const CHAT_IMAGE_COLD_START_MS = 40_000;
const CHAT_IMAGE_DESCRIBE_MS = 30_000;

export function chatImageTurnTimeoutMs(imageCount: number): number {
  if (imageCount <= 0) return CHAT_TURN_TIMEOUT_MS;
  return CHAT_IMAGE_MARGIN_MS + CHAT_IMAGE_COLD_START_MS + imageCount * CHAT_IMAGE_DESCRIBE_MS;
}

/** One pasted image on a chat turn: raw base64 (no data-URL prefix) + mime type. */
export interface ChatTurnImage {
  data: string;
  mime_type: "image/png" | "image/jpeg" | "image/webp";
}

/**
 * POST /api/chat/turn (R8): accepted-only — the response never carries
 * Kira's reply (that's audio-only, observed via is_speaking on the status
 * poll). Same error-mapping shape as postCommand, plus a hard timeout so a
 * hung socket surfaces as a visible, retryable error instead of a dead button.
 */
export async function postChatTurn(
  text: string,
  idempotencyKey: string,
  image?: ChatTurnImage | readonly ChatTurnImage[]
): Promise<ChatTurnAccepted> {
  let res: Response;
  const images: readonly ChatTurnImage[] = image === undefined ? [] : "data" in image ? [image] : image;
  // A pasted image is described by the vision model BEFORE the turn is queued.
  // The backend waits up to 40 s for a cold vision stack (opencohost/core/vision/
  // controller.py DEFAULT_COLD_START_WAIT_S) plus the describe deadline (setting,
  // up to 30 s) for EACH image, so the request gets chatImageTurnTimeoutMs(n)
  // instead of failing before the server does.
  const timeoutMs = chatImageTurnTimeoutMs(images.length);
  try {
    res = await authFetch(`${getApiBaseUrl()}/api/chat/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      // One image keeps the original `image` field (an older backend only knows
      // that one); two or more go as a list, each described in its own call.
      body: JSON.stringify(
        images.length === 0 ? { text } : images.length === 1 ? { text, image: images[0] } : { text, images }
      ),
      // AbortSignal.timeout budgets from creation, so a 401 retry inside
      // authFetch shares the same deadline instead of doubling it.
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    // A timeout arrives as DOMException("TimeoutError"); its native message
    // ("signal timed out") says nothing about which call died. 408 so callers
    // can tell a hang apart from a refusal. Anything else (offline, DNS) keeps
    // its own message.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(`POST /api/chat/turn timed out after ${timeoutMs / 1000}s`, 408);
    }
    throw error;
  }

  if (res.status === 409) {
    throw new ConflictError("chat turn conflict");
  }
  if (res.status === 429) {
    throw new QueueFullError("chat turn queue full");
  }
  if (images.length > 0 && !res.ok) {
    const failure = await visionFailure(res);
    if (failure) throw new ChatImageError(failure.code, res.status, failure.failedImage);
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
