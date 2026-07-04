import { http, HttpResponse } from "msw";
import type { paths } from "../api/types.gen.js";
import type { AgendaResponse, AgendaTopicOut } from "../api/agenda.js";
import type { MusicLibraryResponse } from "../api/music.js";

// Mirrors src/api/client.ts's BASE_URL resolution exactly, so the mock
// handlers always match whatever base URL the app under test actually uses —
// immune to a developer's local .env.local overriding VITE_API_BASE_URL.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

type StatusResponse = paths["/api/status"]["get"]["responses"][200]["content"]["application/json"];
type ProfilesResponse = paths["/api/perfiles"]["get"]["responses"][200]["content"]["application/json"];
type ModelsResponse = paths["/api/models"]["get"]["responses"][200]["content"]["application/json"];
type TtsConfigResponse = paths["/api/tts/config"]["get"]["responses"][200]["content"]["application/json"];
type MemoriaStatsResponse = paths["/api/memoria/stats"]["get"]["responses"][200]["content"]["application/json"];

/** GET /api/chat/last-reply declares response_model=ChatLastReplyResponse on
 * the backend, but types.gen.ts hasn't been regenerated since — hand-typed
 * here, mirrors src/api/client.ts::LastReplyResponse. ponytail: keep in sync manually. */
export interface LastReplyResponse {
  text: string | null;
  source: string | null;
  turn_id: number;
  ts: number | null;
}

export const defaultStatus: StatusResponse = {
  is_ready: true,
  current_model: "qwen3-tts",
  is_speaking: false,
  is_processing: false,
  active_profile: "default",
  health: {
    vram_status: "ok",
    rtf_status: "ok",
    ollama_status: "ok",
    qwen_status: "ok",
    overall_status: "ok",
    ollama_lifecycle: "running",
    qwen_lifecycle: "running",
    free_vram_mb: 4096,
    rtf_rolling_avg: 0.3,
    last_updated: 0
  },
  state_version: 1
};

export const defaultProfiles: ProfilesResponse = { profiles: ["default", "Akira"] };

export const defaultModels: ModelsResponse = {
  catalog: {
    "qwen3:1.7b": { display: "Qwen 3 (1.7B) ⚡", desc: "Ultra rápido.", size_gb: 1.1, family: "qwen3" },
    "llama3.2:3b": { display: "LLaMA 3.2 (3B)", desc: "Español nativo.", size_gb: 2.0, family: "llama" },
    "gemma4:e4b": { display: "Gemma 4 (E4B)", desc: "Más calidad.", size_gb: 2.5, family: "gemma" }
  },
  discovered: ["qwen3:1.7b"],
  current_model: "qwen3:1.7b",
  tiers: { quality: "gemma4:e4b", balanced: "llama3.2:3b", fast: "qwen3:1.7b" },
  active_tier: "fast"
};

export const defaultTtsConfig: TtsConfigResponse = {
  piper_voice: "argentina",
  local_only: true,
  speed: 1.15,
  engine: "ligero",
  heavy_available: false
};

export const defaultLastReply: LastReplyResponse = { text: null, source: null, turn_id: 0, ts: null };

export const defaultMemoriaStats: MemoriaStatsResponse = {
  session_turns: 14,
  digest_entries: 3,
  saved_memorias: 7,
  pinned: 5,
  editorial_cards_by_status: { draft: 1, published: 0, archived: 2 }
};

/** GET /api/memoria/list and POST /api/memoria/purge have no OpenAPI type
 * yet — hand-typed, mirrors src/api/client.ts::MemoriaListResponse /
 * MemoriaPurgeResponse. ponytail: keep in sync manually. */
export interface MemoriaListItemFixture {
  id: string;
  created_at: string;
  updated_at: string;
  revision: number;
  pinned: boolean;
  private: boolean;
}

export const defaultMemoriaList: { items: MemoriaListItemFixture[] } = {
  items: [
    { id: "mem_a", created_at: "2026-01-01T00:00:00+00:00", updated_at: "2026-01-01T00:00:00+00:00", revision: 1, pinned: true, private: false },
    { id: "mem_b", created_at: "2026-01-02T00:00:00+00:00", updated_at: "2026-01-02T00:00:00+00:00", revision: 2, pinned: false, private: true }
  ]
};

/** GET/PUT /api/avatar/config has no OpenAPI response_model type — hand-typed
 * here, mirrors src/api/avatar.ts::AvatarConfigResponse. ponytail: keep in sync manually. */
export interface AvatarConfigResponse {
  enabled: boolean;
  mode: string;
  assets_folder: string;
  state_images: Record<string, string>;
}

export const defaultAvatarConfig: AvatarConfigResponse = {
  enabled: true,
  mode: "image_states",
  assets_folder: "assets/avatar/kira",
  state_images: {
    idle: "assets/avatar/kira/idle.png",
    listening: "assets/avatar/kira/listening.png",
    thinking: "assets/avatar/kira/thinking.png",
    speaking: "assets/avatar/kira/speaking.png",
    speaking_alt: "assets/avatar/kira/speaking_alt.png",
    sleeping: "assets/avatar/kira/sleeping.png",
    angry: "assets/avatar/kira/angry.png",
    error: "assets/avatar/kira/error.png"
  }
};

/** GET/PUT /api/obs/config + POST /api/obs/test has no OpenAPI response_model
 * type — hand-typed here, mirrors src/api/obs.ts::ObsConfigResponse. R8/secret:
 * password is never echoed back, only password_set. ponytail: keep in sync manually. */
export interface ObsConfigResponse {
  enabled: boolean;
  host: string;
  port: number;
  source: string;
  password_set: boolean;
}

export const defaultObsConfig: ObsConfigResponse = {
  enabled: false,
  host: "localhost",
  port: 4455,
  source: "Kira Avatar",
  password_set: true
};

/** GET/POST/PUT /api/stream/chat-live* has no OpenAPI response_model type —
 * hand-typed here, mirrors src/api/stream.ts::StreamChatLiveResponse.
 * R8-CRITICAL: STATE + LIMITS ONLY, never a viewer-chat-text field. */
export interface StreamChatLiveResponse {
  connected: boolean;
  platform: string | null;
  source_id: string | null;
  threshold_per_second: number;
  cooldown_seconds: number;
  max_messages_per_user: number;
  filter_policy: string;
}

export const defaultStreamChatLive: StreamChatLiveResponse = {
  connected: false,
  platform: null,
  source_id: null,
  threshold_per_second: 1,
  cooldown_seconds: 45,
  max_messages_per_user: 10,
  filter_policy: "balanced"
};

function agendaTopic(overrides: Partial<AgendaTopicOut>): AgendaTopicOut {
  return {
    id: "topic-1",
    title: "topic",
    angle: "",
    priority: "normal",
    response_length: "normal",
    status: "queued",
    turns_spoken: 0,
    confidence: "LOW",
    source: "",
    ...overrides
  };
}

const defaultAgendaMetrics: AgendaResponse["metrics"] = {
  total_rejections: 0,
  by_error_code: {},
  by_guardrail: {},
  avg_similarity_overlap_pct: null,
  current_state: "OPEN_TOPIC",
  failure_count: 0,
  response_length: "normal",
  active_topic: "Mods como cultura popular en gaming",
  topics_queued: 2,
  last_outputs_count: 0
};

export const defaultAgenda: AgendaResponse = {
  state: "OPEN_TOPIC",
  active_topic: agendaTopic({
    id: "topic-now",
    title: "Mods como cultura popular en gaming",
    angle: "Cómo la escena de mods redefine juegos viejos",
    status: "active"
  }),
  queued_topics: [
    agendaTopic({ id: "topic-1", title: "La nostalgia noventera en internet", priority: "alta" }),
    agendaTopic({ id: "topic-2", title: "Streamers y burnout", priority: "normal" })
  ],
  drafted_topics: [],
  session_settings: {
    max_turns_per_topic: 3,
    rhythm: "normal",
    response_length: "normal",
    safety_mode: "live_safe",
    profile_style: "Natural"
  },
  metrics: defaultAgendaMetrics
};

export const defaultMusicLibrary: MusicLibraryResponse = {
  tracks: [
    { id: "track-1", label: "ambient_drift.mp3", mood: "calm", status: "ok" },
    { id: "track-2", label: "hype_intro.wav", mood: "hype", status: "ok" },
    { id: "track-3", label: "old_synth.mp3", mood: "nostalgia", status: "faltante" },
    { id: "track-4", label: "broken_file.wav", mood: "tension", status: "invalido" }
  ],
  count: 4,
  moods: ["calm", "hype", "nostalgia", "tension"]
};

export const handlers = [
  http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(defaultStatus)),
  http.get(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json(defaultProfiles)),
  http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json(defaultModels)),
  http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(defaultTtsConfig)),
  http.get(`${API_BASE_URL}/api/memoria/stats`, () => HttpResponse.json(defaultMemoriaStats)),
  http.get(`${API_BASE_URL}/api/memoria/list`, () => HttpResponse.json(defaultMemoriaList)),
  http.post(`${API_BASE_URL}/api/memoria/purge`, () => HttpResponse.json({ deleted: defaultMemoriaList.items.length })),
  http.get(`${API_BASE_URL}/api/chat/last-reply`, () => HttpResponse.json(defaultLastReply)),
  http.get(`${API_BASE_URL}/api/avatar/config`, () => HttpResponse.json(defaultAvatarConfig)),
  http.put(`${API_BASE_URL}/api/avatar/config`, async ({ request }) => {
    const body = (await request.json()) as Partial<AvatarConfigResponse>;
    return HttpResponse.json({ ...defaultAvatarConfig, ...body });
  }),
  http.get(`${API_BASE_URL}/api/obs/config`, () => HttpResponse.json(defaultObsConfig)),
  http.put(`${API_BASE_URL}/api/obs/config`, async ({ request }) => {
    const body = (await request.json()) as Partial<ObsConfigResponse> & { password?: string };
    const { password: _password, ...rest } = body;
    return HttpResponse.json({ ...defaultObsConfig, ...rest, password_set: defaultObsConfig.password_set });
  }),
  http.post(`${API_BASE_URL}/api/obs/test`, () => HttpResponse.json({ ok: true, error: null })),
  http.get(`${API_BASE_URL}/api/stream/chat-live`, () => HttpResponse.json(defaultStreamChatLive)),
  http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () =>
    HttpResponse.json({ ...defaultStreamChatLive, connected: true, platform: "twitch", source_id: "kira" })
  ),
  http.post(`${API_BASE_URL}/api/stream/chat-live/disconnect`, () =>
    HttpResponse.json({ ...defaultStreamChatLive, connected: false })
  ),
  http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, async ({ request }) => {
    const body = (await request.json()) as Partial<StreamChatLiveResponse>;
    return HttpResponse.json({ ...defaultStreamChatLive, ...body });
  }),
  http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued" })
  ),
  http.post(`${API_BASE_URL}/api/commands`, () =>
    HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 })
  ),
  http.post(`${API_BASE_URL}/api/chat/turn`, () =>
    HttpResponse.json({ accepted: true, command_id: "cmd-chat-1", status: "queued", state_version: 2 })
  ),
  http.get(`${API_BASE_URL}/api/music/library`, () => HttpResponse.json(defaultMusicLibrary)),
  http.get(`${API_BASE_URL}/api/agenda`, () => HttpResponse.json(defaultAgenda)),
  http.post(`${API_BASE_URL}/api/agenda/topic`, async ({ request }) => {
    const body = (await request.json()) as { title: string; angle?: string };
    const next: AgendaResponse = {
      ...defaultAgenda,
      queued_topics: [
        ...defaultAgenda.queued_topics,
        agendaTopic({ id: `topic-${defaultAgenda.queued_topics.length + 1}`, title: body.title, angle: body.angle ?? "" })
      ]
    };
    return HttpResponse.json(next);
  }),
  http.post(`${API_BASE_URL}/api/agenda/topic/action`, () => HttpResponse.json(defaultAgenda)),
  http.put(`${API_BASE_URL}/api/agenda/session`, () => HttpResponse.json(defaultAgenda))
];

/** Per-test override: switch rejected with 409 conflict. */
export function switchConflictHandler() {
  return http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: false, reason: "conflict" }, { status: 409 })
  );
}

/** Per-test override: switch rejected with 429 queue_full. */
export function switchQueueFullHandler() {
  return http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: false, reason: "queue_full" }, { status: 429 })
  );
}

/** Per-test override: switch rejected with 404 unknown profile. */
export function switchNotFoundHandler() {
  return http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ detail: "profile not found" }, { status: 404 })
  );
}

/**
 * Per-test override: same Idempotency-Key always replays the same command_id
 * (backend dedupe), asserting the client never treats a replay as a new apply.
 */
export function switchReplayHandler(commandId: string) {
  return http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: true, command_id: commandId, status: "queued" })
  );
}

/** Per-test override: POST /api/commands rejected with 409 conflict. */
export function commandConflictHandler() {
  return http.post(`${API_BASE_URL}/api/commands`, () =>
    HttpResponse.json({ accepted: false, reason: "conflict" }, { status: 409 })
  );
}

/** Per-test override: POST /api/commands rejected with 429 queue_full. */
export function commandQueueFullHandler() {
  return http.post(`${API_BASE_URL}/api/commands`, () =>
    HttpResponse.json({ accepted: false, reason: "queue_full" }, { status: 429 })
  );
}

/** Per-test override: POST /api/commands rejected with 422 (invalid value/unknown command). */
export function commandValidationHandler(detail = "invalid command") {
  return http.post(`${API_BASE_URL}/api/commands`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/commands fails at the network level (no response at all). */
export function commandNetworkErrorHandler() {
  return http.post(`${API_BASE_URL}/api/commands`, () => HttpResponse.error());
}

/** Per-test override: POST /api/chat/turn rejected with 409 conflict. */
export function chatTurnConflictHandler() {
  return http.post(`${API_BASE_URL}/api/chat/turn`, () =>
    HttpResponse.json({ accepted: false, reason: "conflict" }, { status: 409 })
  );
}

/** Per-test override: POST /api/chat/turn rejected with 429 queue_full. */
export function chatTurnQueueFullHandler() {
  return http.post(`${API_BASE_URL}/api/chat/turn`, () =>
    HttpResponse.json({ accepted: false, reason: "queue_full" }, { status: 429 })
  );
}

/** Per-test override: POST /api/chat/turn rejected with 422 (invalid text). */
export function chatTurnValidationHandler(detail = "text must be non-empty") {
  return http.post(`${API_BASE_URL}/api/chat/turn`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/chat/turn fails at the network level (no response at all). */
export function chatTurnNetworkErrorHandler() {
  return http.post(`${API_BASE_URL}/api/chat/turn`, () => HttpResponse.error());
}

/**
 * Single-dispatcher command stub — reproduces the REAL backend's
 * state_version semantics (judgment-day HIGH #1/#2 root cause): GET
 * /api/status and POST /api/commands share ONE counter, bumped ONLY at
 * ENQUEUE/accept time. GET /api/status just reads the counter back — it
 * never advances again just because the engine finished applying a
 * command. Any convergence logic that waits for
 * `GET.state_version > accepted.state_version` (the accept-time baseline)
 * can NEVER converge against this stub, because that comparison is always
 * `N > N`. Use this (instead of a hand-rolled 200 for POST /api/commands)
 * whenever a test needs an honest accepted -> poll cycle for a command with
 * no real "applied" field to observe.
 */
export function commandDispatcherHandlers(initial: Partial<StatusResponse> = {}) {
  let status: StatusResponse = { ...defaultStatus, ...initial };
  return [
    http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(status)),
    http.post(`${API_BASE_URL}/api/commands`, () => {
      status = { ...status, state_version: status.state_version + 1 };
      return HttpResponse.json({
        accepted: true,
        command_id: `cmd-${status.state_version}`,
        status: "queued",
        state_version: status.state_version
      });
    })
  ];
}

/**
 * GET /api/status pinned to a fixed `state_version` forever — the "GET
 * never independently advances state_version" half of the single-dispatcher
 * contract above, for tests that supply their own POST /api/commands
 * handler (e.g. to capture headers/body) and just need GET to stay honest
 * about not being an applied signal.
 */
export function frozenStatusHandler(stateVersion: number, overrides: Partial<StatusResponse> = {}) {
  return http.get(`${API_BASE_URL}/api/status`, () =>
    HttpResponse.json({ ...defaultStatus, ...overrides, state_version: stateVersion })
  );
}

/**
 * GET /api/status that never converges no matter how long a test polls it —
 * `current_model` (and everything else) stays frozen at `defaultStatus`.
 * Used to exercise the soft APPLY_TIMEOUT_MS ceiling for `matches`-based
 * commands (e.g. switch_model) whose real applied field never flips.
 */
export function neverConvergesStatusHandler() {
  return http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(defaultStatus));
}

/**
 * Per-test override simulating the ~2s accepted-to-applied lag: `GET /api/status`
 * keeps returning `oldProfile` for `flipAfterCalls` requests, then flips to
 * `newProfile` on every call after that.
 */
export function evolvingStatusHandler(oldProfile: string, newProfile: string, flipAfterCalls: number) {
  let calls = 0;
  return http.get(`${API_BASE_URL}/api/status`, () => {
    calls += 1;
    return HttpResponse.json({
      ...defaultStatus,
      active_profile: calls > flipAfterCalls ? newProfile : oldProfile
    });
  });
}

/** Per-test override: GET /api/avatar/config fails. */
export function avatarConfigGetErrorHandler() {
  return http.get(`${API_BASE_URL}/api/avatar/config`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }));
}

/** Per-test override: PUT /api/avatar/config rejected with 422 (unknown state). */
export function avatarConfigPutValidationHandler(detail = "unknown avatar state(s): bogus") {
  return http.put(`${API_BASE_URL}/api/avatar/config`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: GET /api/obs/config fails. */
export function obsConfigGetErrorHandler() {
  return http.get(`${API_BASE_URL}/api/obs/config`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }));
}

/** Per-test override: POST /api/obs/test reports a failed connection. */
export function obsTestFailureHandler(error = "connection refused") {
  return http.post(`${API_BASE_URL}/api/obs/test`, () => HttpResponse.json({ ok: false, error }));
}

/** Per-test override: POST /api/stream/chat-live/connect rejected with 422 invalid_url. */
export function streamConnectInvalidUrlHandler() {
  return http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () =>
    HttpResponse.json({ detail: "invalid_url" }, { status: 422 })
  );
}

/** Per-test override: POST /api/stream/chat-live/connect rejected with 409 busy (aggregator lock held). */
export function streamConnectBusyHandler() {
  return http.post(`${API_BASE_URL}/api/stream/chat-live/connect`, () =>
    HttpResponse.json({ detail: "busy" }, { status: 409 })
  );
}

/** Per-test override: PUT /api/stream/chat-live/limits rejected with 422 invalid_filter_policy. */
export function streamLimitsValidationHandler(detail = "invalid_filter_policy") {
  return http.put(`${API_BASE_URL}/api/stream/chat-live/limits`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: GET /api/stream/chat-live returns 503 (no aggregator wired). */
export function streamChatLiveUnavailableHandler() {
  return http.get(`${API_BASE_URL}/api/stream/chat-live`, () =>
    HttpResponse.json({ detail: "stream_unavailable" }, { status: 503 })
  );
}

/** Per-test override: GET /api/chat/last-reply returns a fixed reply. */
export function lastReplyHandler(reply: Partial<LastReplyResponse>) {
  return http.get(`${API_BASE_URL}/api/chat/last-reply`, () =>
    HttpResponse.json({ ...defaultLastReply, ...reply })
  );
}

/**
 * Per-test override simulating a reply landing after the operator sends a
 * turn: GET /api/chat/last-reply keeps returning `before` for `flipAfterCalls`
 * requests, then flips to `after` (new turn_id) on every call after that.
 */
export function evolvingLastReplyHandler(
  before: Partial<LastReplyResponse>,
  after: Partial<LastReplyResponse>,
  flipAfterCalls: number
) {
  let calls = 0;
  return http.get(`${API_BASE_URL}/api/chat/last-reply`, () => {
    calls += 1;
    return HttpResponse.json({ ...defaultLastReply, ...(calls > flipAfterCalls ? after : before) });
  });
}

/** Per-test override: GET /api/music/library returns a caller-supplied response (e.g. empty library). */
export function musicLibraryGetHandler(response: MusicLibraryResponse) {
  return http.get(`${API_BASE_URL}/api/music/library`, () => HttpResponse.json(response));
}

/** Per-test override: GET /api/music/library fails (music_unavailable / 503, or any other failure). */
export function musicLibraryGetErrorHandler(status = 503, detail = "music_unavailable") {
  return http.get(`${API_BASE_URL}/api/music/library`, () => HttpResponse.json({ detail }, { status }));
}

/** Per-test override: GET /api/agenda returns a caller-supplied response (e.g. an empty queue). */
export function agendaGetHandler(response: AgendaResponse) {
  return http.get(`${API_BASE_URL}/api/agenda`, () => HttpResponse.json(response));
}

/** Per-test override: GET /api/agenda fails (agenda unavailable / 503, or any other failure). */
export function agendaGetErrorHandler(status = 503, detail = "agenda_unavailable") {
  return http.get(`${API_BASE_URL}/api/agenda`, () => HttpResponse.json({ detail }, { status }));
}

/** Per-test override: POST /api/agenda/topic rejected with 422 (e.g. sanitize_topic_text failure). */
export function agendaTopicValidationHandler(detail = "invalid topic") {
  return http.post(`${API_BASE_URL}/api/agenda/topic`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/agenda/topic/action captures the request body for assertions. */
export function agendaTopicActionCaptureHandler(capture: { body?: unknown }, response: AgendaResponse = defaultAgenda) {
  return http.post(`${API_BASE_URL}/api/agenda/topic/action`, async ({ request }) => {
    capture.body = await request.json();
    return HttpResponse.json(response);
  });
}

/** Per-test override: PUT /api/agenda/session captures the request body for assertions. */
export function agendaSessionCaptureHandler(capture: { body?: unknown }, response: AgendaResponse = defaultAgenda) {
  return http.put(`${API_BASE_URL}/api/agenda/session`, async ({ request }) => {
    capture.body = await request.json();
    return HttpResponse.json(response);
  });
}

/** Per-test override: GET /api/status's current_model flips after N calls (switch_model convergence). */
export function evolvingCurrentModelHandler(oldModel: string, newModel: string, flipAfterCalls: number) {
  let calls = 0;
  return http.get(`${API_BASE_URL}/api/status`, () => {
    calls += 1;
    return HttpResponse.json({
      ...defaultStatus,
      current_model: calls > flipAfterCalls ? newModel : oldModel
    });
  });
}
