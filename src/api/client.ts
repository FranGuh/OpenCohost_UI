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
export type ModelsResponse = paths["/api/models"]["get"]["responses"][200]["content"]["application/json"];
export type TtsConfigResponse = paths["/api/tts/config"]["get"]["responses"][200]["content"]["application/json"];
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
 * header, exactly as it did before this track (owner decision D2:
 * enforcement stays default OFF).
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
 * `fetch` wrapper for mutating (`POST`/`PUT`/`DELETE`) calls to operator
 * endpoints — attaches `Authorization: Bearer <token>` when a token is
 * cached, and none otherwise (D2: a missing token must never break the
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

export async function getPerfiles(): Promise<ProfilesResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/perfiles`);
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

export async function getTtsConfig(): Promise<TtsConfigResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/tts/config`);
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
  const res = await fetch(`${getApiBaseUrl()}/api/memoria/stats${query}`);
  if (!res.ok) {
    throw new ApiError(`GET /api/memoria/stats failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaStatsResponse;
}

export async function getMemoriaList(profileId: string): Promise<MemoriaListResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/memoria/list?profile_id=${encodeURIComponent(profileId)}`);
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
  idempotencyKey: string
): Promise<CommandAccepted> {
  const payload = command === "clear_history" ? {} : { value };
  const res = await authFetch(`${getApiBaseUrl()}/api/commands`, {
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

export async function getLastReply(): Promise<LastReplyResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/chat/last-reply`);
  if (!res.ok) {
    throw new ApiError(`GET /api/chat/last-reply failed with ${res.status}`, res.status);
  }
  return (await res.json()) as LastReplyResponse;
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

/**
 * POST /api/chat/turn (R8): accepted-only — the response never carries
 * Kira's reply (that's audio-only, observed via is_speaking on the status
 * poll). Same error-mapping shape as postCommand, plus a hard timeout so a
 * hung socket surfaces as a visible, retryable error instead of a dead button.
 */
export async function postChatTurn(text: string, idempotencyKey: string): Promise<ChatTurnAccepted> {
  let res: Response;
  try {
    res = await authFetch(`${getApiBaseUrl()}/api/chat/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({ text }),
      // AbortSignal.timeout budgets from creation, so a 401 retry inside
      // authFetch shares the same deadline instead of doubling it.
      signal: AbortSignal.timeout(CHAT_TURN_TIMEOUT_MS)
    });
  } catch (error) {
    // A timeout arrives as DOMException("TimeoutError"); its native message
    // ("signal timed out") says nothing about which call died. 408 so callers
    // can tell a hang apart from a refusal. Anything else (offline, DNS) keeps
    // its own message.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(`POST /api/chat/turn timed out after ${CHAT_TURN_TIMEOUT_MS / 1000}s`, 408);
    }
    throw error;
  }

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
