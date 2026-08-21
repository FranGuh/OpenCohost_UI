import { http, HttpResponse } from "msw";
import { LLM_PROVIDER_PRESETS } from "../api/llmProvider.js";
import type { paths } from "../api/types.gen.js";
import type {
  AgendaResponse,
  AgendaTopicOut,
  CohostProfileOut,
  CohostProfilesResponse,
  CohostProfileSelectResponse
} from "../api/agenda.js";
import type {
  MusicImportResponse,
  MusicLibraryResponse,
  MusicMoodResponse,
  MusicStateResponse,
  MusicTrackOut
} from "../api/music.js";
import type { EventLogResponse } from "../api/events.js";
import type { PttConfigResponse, PttStartResponse, PttStateResponse, PttStopResponse, PttTestResponse } from "../api/ptt.js";

// Mirrors src/api/client.ts's BASE_URL resolution exactly, so the mock
// handlers always match whatever base URL the app under test actually uses —
// immune to a developer's local .env.local overriding VITE_API_BASE_URL.
// Fallback kept in sync manually with client.ts::DEFAULT_API_BASE_URL.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765";

// active_profile_id / provider / transport / fallback_active mirror
// src/api/client.ts's hand-added StatusResponse fields (snapshot lag —
// types.gen.ts predates them). ponytail: keep in sync.
type StatusResponse = paths["/api/status"]["get"]["responses"][200]["content"]["application/json"] & {
  active_profile_id?: string | null;
  provider?: string;
  transport?: string;
  fallback_active?: boolean;
  // cloud_rearm_20260801 WU5 — mirrors src/api/client.ts's hand-added
  // StatusResponse fields. ponytail: keep in sync.
  fallback_reason?: string | null;
  next_cloud_probe_in_seconds?: number | null;
  // Unit 2.5 (runtime_findings_batch_20260731 F13) — mirrors src/api/client.ts's
  // hand-added StatusResponse fields. ponytail: keep in sync.
  session_mode?: "agenda" | "post-agenda" | "inactiva";
  llm_generating?: boolean;
  pending_commands_count?: number;
  ctx_telemetry?: {
    ratio: number;
    effective_ctx: number;
    native_ctx: number;
    evicted_pairs: number;
    source: string;
  } | null;
  // Resource numbers (runtime_findings_batch_20260731 F9/F14/2.4) — mirrors
  // src/api/client.ts's hand-added HealthState fields.
  health: {
    total_vram_mb?: number;
    used_vram_mb?: number;
    model_resident_mb_est?: number | null;
    model_vram_mb_est?: number | null;
    model_ram_spill_mb_est?: number | null;
    model_processor_split?: string | null;
  };
};
type ProfilesResponse = paths["/api/perfiles"]["get"]["responses"][200]["content"]["application/json"];
type ModelsResponse = paths["/api/models"]["get"]["responses"][200]["content"]["application/json"];
type TtsConfigResponse = paths["/api/tts/config"]["get"]["responses"][200]["content"]["application/json"] & {
  piper_available?: boolean;
  edge_tts_offline?: boolean;
};
// saved_memorias_total / pinned_total mirror src/api/client.ts's hand-added
// MemoriaStatsResponse fields (FIX-A, snapshot lag). ponytail: keep in sync.
type MemoriaStatsResponse = paths["/api/memoria/stats"]["get"]["responses"][200]["content"]["application/json"] & {
  saved_memorias_total?: number;
  pinned_total?: number;
};

/** GET /api/chat/last-reply declares response_model=ChatLastReplyResponse on
 * the backend, but types.gen.ts hasn't been regenerated since — hand-typed
 * here, mirrors src/api/client.ts::LastReplyResponse. ponytail: keep in sync manually. */
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

// `avatar_state` is deliberately OMITTED from this base fixture, hence the
// Omit<>. The real server always sends it (the field carries a default), but
// most avatar tests spread this object and flip `is_speaking`/`is_processing`
// /`is_ready` to exercise CLIENT-SIDE derivation — supplying `avatar_state`
// here would short-circuit that branch and make those tests assert nothing.
// A test that wants the backend-passthrough path adds the field explicitly.
export const defaultStatus: Omit<StatusResponse, "avatar_state"> = {
  is_ready: true,
  current_model: "qwen3-tts",
  is_speaking: false,
  is_processing: false,
  active_profile: "default",
  active_profile_id: "profile-id-default",
  provider: "local",
  transport: "local",
  fallback_active: false,
  session_mode: "inactiva",
  llm_generating: false,
  pending_commands_count: 0,
  // Carries a `default` in the backend model, so the server always sends it.
  // The mock omitted it while types.gen.ts was six weeks stale and could not
  // say so. Unlike `avatar_state` above, adding it changes no test semantics.
  ollama_warming: false,
  ctx_telemetry: null,
  health: {
    vram_status: "ok",
    rtf_status: "ok",
    ollama_status: "ok",
    qwen_status: "ok",
    overall_status: "ok",
    ollama_lifecycle: "running",
    qwen_lifecycle: "running",
    free_vram_mb: 4096,
    total_vram_mb: 8192,
    used_vram_mb: 4096,
    rtf_rolling_avg: 0.3,
    last_updated: 0,
    // Deliberately not round multiples of 10 — StatusRail.test.tsx:243 pins
    // that no VRAM/model row ever renders a bare "0 MB", and "...00 MB"
    // values (e.g. 6300) would false-positive that substring check.
    model_resident_mb_est: 6144,
    model_vram_mb_est: 4352,
    model_ram_spill_mb_est: 1792,
    model_processor_split: "67% GPU / 33% CPU"
  },
  state_version: 1
};

export const defaultProfiles: ProfilesResponse = { profiles: ["default", "Akira"] };

/** GET /api/perfiles/{name} has no OpenAPI type yet — hand-typed here,
 * mirrors src/api/profiles.ts::ProfileDetailResponse. ponytail: keep in
 * sync manually. */
export interface ProfileDetailResponseFixture {
  name: string;
  id: string;
  prompt: string;
  use_system: boolean;
}

/** Per-profile id/prompt/use_system fixtures backing the default GET
 * /api/perfiles/:name handler below — keyed by name to mirror the real
 * profiles.json shape closely enough for tests. */
export const defaultProfileDetails: Record<string, ProfileDetailResponseFixture> = {
  default: { name: "default", id: "profile-id-default", prompt: "", use_system: true },
  Akira: { name: "Akira", id: "profile-id-akira", prompt: "Sos ingeniosa y filosa, con humor seco.", use_system: false }
};

export const defaultModels: ModelsResponse = {
  catalog: {
    "qwen3:1.7b": { display: "Qwen 3 (1.7B) ⚡", desc: "Ultra rápido.", size_gb: 1.1, family: "qwen3" },
    "llama3.2:3b": { display: "LLaMA 3.2 (3B)", desc: "Español nativo.", size_gb: 2.0, family: "llama" },
    "gemma4:e4b": { display: "Gemma 4 (E4B)", desc: "Más calidad.", size_gb: 2.5, family: "gemma" }
  },
  discovered: ["qwen3:1.7b", "llama3.2:3b", "gemma4:e4b"],
  current_model: "qwen3:1.7b",
  tiers: { quality: "gemma4:e4b", balanced: "llama3.2:3b", fast: "qwen3:1.7b" },
  active_tier: "fast"
};

/** Cloud mode GET /api/models — mirrors opencohost/api/routers/status.py's
 * get_models cloud branch (~:128-134): empty catalog/tiers, `discovered`
 * degenerates to just the active model. */
export const cloudModels: ModelsResponse = {
  catalog: {},
  discovered: ["gpt-4o-mini"],
  current_model: "gpt-4o-mini",
  tiers: {},
  active_tier: "cloud"
};

export const defaultTtsConfig: TtsConfigResponse = {
  piper_voice: "neutral",
  local_only: true,
  speed: 1.15,
  engine: "ligero",
  heavy_available: false,
  piper_available: true,
  edge_tts_offline: false
};

export const defaultLastReply: LastReplyResponse = {
  text: null,
  source: null,
  turn_id: 0,
  ts: null,
  queue_wait_ms: null,
  answered_by_provider: null,
  answered_by_transport: null,
  submitted_under_provider: null,
  provider_changed_while_queued: null,
  origin: null
};

export const defaultMemoriaStats: MemoriaStatsResponse = {
  session_turns: 14,
  digest_entries: 3,
  // Per-profile figures (FIX-A) — deliberately smaller than the *_total below
  // so a test can tell the per-profile split from the global totals.
  saved_memorias: 7,
  pinned: 5,
  saved_memorias_total: 12,
  pinned_total: 9,
  editorial_cards_by_status: { draft: 1, published: 0, archived: 2 }
};

/** GET /api/memoria/list and POST /api/memoria/purge have no OpenAPI type
 * yet — hand-typed, mirrors src/api/client.ts::MemoriaListResponse /
 * MemoriaPurgeResponse. ponytail: keep in sync manually. */
export interface MemoriaListItemFixture {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  revision: number;
  pinned: boolean;
  private: boolean;
  inactive: boolean;
  // memoria_import_20260718 WU4: the list projection now carries `imported`
  // (opencohost/api/main.py::get_memoria_list computes it from the row status)
  // so MemoriaRow can render the "importada" badge. ponytail: keep in sync.
  imported: boolean;
  // memoria_draft_visibility_20260725: mirrors `imported`'s derivation shape
  // (status='draft' -> true) so MemoriaRow can render the "borrador" badge.
  draft: boolean;
}

export const defaultMemoriaList: { items: MemoriaListItemFixture[] } = {
  items: [
    {
      id: "mem_a",
      title: "Título memoria A",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-01T00:00:00+00:00",
      revision: 1,
      pinned: true,
      private: false,
      inactive: false,
      imported: false,
      // Pin promotes to 'curated' one-way server-side (F5) — a pinned row is
      // never a draft.
      draft: false
    },
    {
      id: "mem_b",
      title: "Título memoria B",
      created_at: "2026-01-02T00:00:00+00:00",
      updated_at: "2026-01-02T00:00:00+00:00",
      revision: 2,
      pinned: false,
      private: true,
      inactive: false,
      imported: false,
      // Private also promotes to 'curated' one-way (F5) — same reasoning.
      draft: false
    },
    {
      id: "mem_c",
      title: "Título memoria C",
      created_at: "2026-01-03T00:00:00+00:00",
      updated_at: "2026-01-03T00:00:00+00:00",
      revision: 1,
      pinned: false,
      private: false,
      inactive: false,
      imported: false,
      // memoria_draft_visibility_20260725: a genuine unconfirmed auto-capture.
      draft: true
    }
  ]
};

/** POST /api/memoria/import response — mirrors
 * opencohost/api/models.py::MemoriaImportResponse (counts ONLY, R8). WU4.
 * ponytail: keep in sync manually. */
export interface MemoriaImportResponseFixture {
  ok: boolean;
  imported: number;
  skipped_duplicates: number;
  skipped_too_short: number;
  skipped_cap: number;
  failed: number;
}

export const defaultMemoriaImport: MemoriaImportResponseFixture = {
  ok: true,
  imported: 3,
  skipped_duplicates: 1,
  skipped_too_short: 2,
  skipped_cap: 0,
  failed: 0
};

/** GET /api/memoria/row/{id} response — hand-typed, mirrors
 * src/api/memoria.ts::MemoriaRowResponse. WU-H (operator viewing decision):
 * the ONLY memoria fixture that carries `content` — on-demand, one row at a
 * time. ponytail: keep in sync manually. */
export interface MemoriaRowResponseFixture {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  private: boolean;
  inactive: boolean;
  /** memoria_draft_visibility_20260725 — required on MemoriaRowResponse
   * (src/api/client.ts). No consumer reads it yet, so nothing fails without it;
   * it is here so the fixture cannot disagree with the contract it mirrors. */
  draft: boolean;
}

export const defaultMemoriaRows: Record<string, MemoriaRowResponseFixture> = {
  mem_a: {
    id: "mem_a",
    title: "Título memoria A",
    content: "Contenido completo de la memoria A.",
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    pinned: true,
    private: false,
    inactive: false,
    draft: false
  },
  mem_b: {
    id: "mem_b",
    title: "Título memoria B",
    content: "Contenido completo de la memoria B.",
    created_at: "2026-01-02T00:00:00+00:00",
    updated_at: "2026-01-02T00:00:00+00:00",
    pinned: false,
    private: true,
    inactive: false,
    draft: false
  }
};

/** POST /api/memoria/{flags,delete,update,capture} response — mirrors
 * src/api/client.ts::MemoriaMutationResponse / memoria.ts's re-export. */
export interface MemoriaMutationResponseFixture {
  ok: boolean;
}

/** GET/POST /api/memoria/notice response — mirrors
 * src/api/memoria.ts::MemoriaNoticeResponse. */
export interface MemoriaNoticeResponseFixture {
  dismissed: boolean;
}

export const defaultMemoriaNotice: MemoriaNoticeResponseFixture = { dismissed: false };

/** GET/PUT/DELETE /api/personalization response — mirrors
 * src/api/personalization.ts::PersonalizationResponse. */
export interface PersonalizationResponseFixture {
  enabled: boolean;
  nickname: string;
  occupation: string;
  interests: string;
  custom_instructions: string;
  updated_at: string | null;
}

export const defaultPersonalization: PersonalizationResponseFixture = {
  enabled: true,
  nickname: "",
  occupation: "",
  interests: "",
  custom_instructions: "",
  updated_at: null
};

/** GET/PUT /api/i18n has no OpenAPI response_model type — hand-typed here,
 * mirrors src/api/i18n.ts::I18nStateResponse. D6: `pending_restart` is the
 * only "restart required" signal — `active_locale` never changes mid-process. */
export interface I18nStateResponseFixture {
  active_locale: string;
  persisted_locale: string;
  pending_restart: boolean;
  available: { code: string; display: string; tier: string; status: string }[];
  warnings: { code: string; message: string }[];
}

export const defaultI18nState: I18nStateResponseFixture = {
  active_locale: "es",
  persisted_locale: "es",
  pending_restart: false,
  available: [
    { code: "es", display: "Español", tier: "official", status: "complete" },
    { code: "en", display: "English", tier: "official", status: "partial" }
  ],
  warnings: []
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

/** GET/PUT /api/llm/provider (multi_provider_llm_20260723) has no OpenAPI
 * response_model type — hand-typed here, mirrors
 * src/api/llmProvider.ts::LlmProviderResponse. SECRET: no api_key field ever;
 * only per-profile api_key_set. ponytail: keep in sync manually. */
export interface LlmProviderResponseFixture {
  active_provider: string;
  fallback_mode: "auto" | "manual";
  pregen_enabled: boolean;
  profiles: Record<string, { base_url: string; model: string; preset: string; api_key_set: boolean }>;
}

export const defaultLlmProvider: LlmProviderResponseFixture = {
  active_provider: "local",
  fallback_mode: "auto",
  pregen_enabled: false,
  profiles: {
    openai: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", preset: "openai", api_key_set: true }
  }
};

/** Mirrors opencohost/config/settings.py::LLM_PROVIDER_PRESETS's curated
 * `models` list (server prefills with `models[0]`) — mock-only; the client
 * mirror (src/api/llmProvider.ts::LLM_PROVIDER_PRESETS) only carries
 * {label, base_url}, not model defaults. ponytail: keep in sync manually. */
const LLM_PROVIDER_PRESET_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  nvidia_nim: "meta/llama-3.1-70b-instruct"
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
  input_contract: boolean;
  stream_over_agenda: boolean;
  stream_ttl_seconds: number;
  effective_stream_ttl_seconds: number;
  adaptive_activation: boolean;
}

// Default: agenda-first (stream_over_agenda: false) with a chosen TTL that
// already sits at the 300s floor, so chosen === effective and the
// AccionesCard disclosure stays quiet by default — per-test overrides below
// diverge the two to exercise the disclosure itself.
export const defaultStreamChatLive: StreamChatLiveResponse = {
  connected: false,
  platform: null,
  source_id: null,
  threshold_per_second: 1,
  cooldown_seconds: 45,
  max_messages_per_user: 10,
  filter_policy: "balanced",
  input_contract: false,
  stream_over_agenda: false,
  stream_ttl_seconds: 300,
  effective_stream_ttl_seconds: 300,
  adaptive_activation: false
};

/** GET /api/stream/chat-live/messages (RF3) — mirrors
 * src/api/stream.ts::StreamChatMessagesResponse. Default: empty backlog, so
 * every existing test that renders ConversationPanel (StreamChatPanel is
 * kept mounted by Tabs — src/ui/Tabs.tsx — regardless of the active tab)
 * gets a benign 200 instead of an unhandled-request error
 * (src/test/setup.ts uses onUnhandledRequest: "error"). */
export interface StreamChatMessagesResponse {
  messages: Array<{ seq: number; author: string; text: string; ts: number }>;
  cursor: number;
  boot: number;
  session: number;
  more_pending: boolean;
}

export const defaultStreamChatMessages: StreamChatMessagesResponse = {
  messages: [],
  cursor: 0,
  boot: 1,
  session: 0,
  more_pending: false
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
  drafted_topics: [
    agendaTopic({
      id: "topic-draft-1",
      title: "IA generativa en overlays de stream",
      angle: "Dónde está la línea entre herramienta y reemplazo.",
      confidence: "HIGH",
      status: "drafted"
    }),
    agendaTopic({
      id: "topic-draft-2",
      title: "Por qué el chat repite memes viejos",
      angle: "Nostalgia colectiva a escala de comunidad.",
      confidence: "MEDIUM",
      status: "drafted"
    })
  ],
  session_settings: {
    max_turns_per_topic: 3,
    rhythm: "normal",
    response_length: "normal",
    safety_mode: "live_safe",
    profile_style: "Natural"
  },
  metrics: defaultAgendaMetrics
};

function cohostProfile(overrides: Partial<CohostProfileOut>): CohostProfileOut {
  return {
    name: "Natural",
    style: "Soná como co-host natural de stream: cercana, con humor seco.",
    default_priority: "normal",
    default_response_length: "normal",
    ...overrides
  };
}

export const defaultCohostProfiles: CohostProfilesResponse = {
  profiles: [
    cohostProfile({ name: "Natural" }),
    cohostProfile({
      name: "Filosa",
      style: "Sarcástica y directa, sin filtro pero sin cruzar la línea.",
      default_priority: "alta"
    })
  ]
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

/** Mirrors opencohost/core/music_library.py::KNOWN_MOODS exactly (also
 * mirrored client-side by src/api/mock/fixtures.ts::MUSIC_FIXTURE.moods,
 * the quick-test button set in MoodCard). */
const KNOWN_MOODS = ["normal", "nostalgia", "hype", "tension", "sad", "calm", "comedy", "ending"];

export const defaultMusicState: MusicStateResponse = { active_mood: "normal", fade: null };
export const defaultEvents: EventLogResponse = { events: [], cursor: 0, boot: 0 };

/** POST/GET /api/ptt/* fixtures — mirrors src/api/ptt.ts's hand-typed shapes.
 * PRIVACY: never a text field, `buffered_chars` is a count only. ponytail: keep in sync manually. */
export const defaultPttStart: PttStartResponse = { session_id: "ptt-session-1", state: "listening" };
export const defaultPttStop: PttStopResponse = { state: "flushing" };
export const defaultPttState: PttStateResponse = {
  state: "idle",
  session_id: null,
  buffered_chars: 0,
  last_error: null,
  stt_ws_url: "ws://127.0.0.1:9090"
};

function musicTracksForMood(library: MusicLibraryResponse, mood: string): MusicTrackOut[] {
  return library.tracks.filter((track) => track.mood === mood && track.status === "ok");
}

/** Mirrors MusicLibrary.select_for_mood's mood->normal->any fallback closely
 * enough for tests: first valid track in the requested mood, else the first
 * valid track anywhere. */
function suggestedTrackFor(library: MusicLibraryResponse, mood: string): string | null {
  const matching = musicTracksForMood(library, mood);
  if (matching.length > 0) {
    return matching[0].id;
  }
  const fallback = library.tracks.find((track) => track.status === "ok");
  return fallback ? fallback.id : null;
}

export const handlers = [
  http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(defaultStatus)),
  http.get(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json(defaultProfiles)),
  http.get(`${API_BASE_URL}/api/perfiles/:name`, ({ params }) => {
    const name = decodeURIComponent(String(params.name));
    const detail = defaultProfileDetails[name];
    if (!detail) {
      return HttpResponse.json({ detail: "profile not found" }, { status: 404 });
    }
    return HttpResponse.json(detail);
  }),
  http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
    const body = (await request.json()) as { name: string; prompt: string; use_system?: boolean };
    return HttpResponse.json({
      name: body.name,
      id: `profile-id-${body.name}`,
      prompt: body.prompt,
      use_system: body.use_system ?? false
    });
  }),
  http.put(`${API_BASE_URL}/api/perfiles/:name`, async ({ request, params }) => {
    const name = decodeURIComponent(String(params.name));
    const body = (await request.json()) as { new_name?: string; prompt?: string; use_system?: boolean };
    const current = defaultProfileDetails[name] ?? { name, id: `profile-id-${name}`, prompt: "", use_system: false };
    return HttpResponse.json({
      name: body.new_name ?? current.name,
      id: current.id,
      prompt: body.prompt ?? current.prompt,
      use_system: body.use_system ?? current.use_system
    });
  }),
  http.delete(`${API_BASE_URL}/api/perfiles/:name`, () => HttpResponse.json({ ok: true })),
  http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json(defaultModels)),
  http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(defaultTtsConfig)),
  http.get(`${API_BASE_URL}/api/memoria/stats`, () => HttpResponse.json(defaultMemoriaStats)),
  http.get(`${API_BASE_URL}/api/memoria/list`, () => HttpResponse.json(defaultMemoriaList)),
  http.get(`${API_BASE_URL}/api/memoria/row/:rowId`, ({ params }) => {
    const row = defaultMemoriaRows[String(params.rowId)];
    if (!row) {
      return HttpResponse.json({ detail: "memoria not found" }, { status: 404 });
    }
    return HttpResponse.json(row);
  }),
  http.post(`${API_BASE_URL}/api/memoria/purge`, () => HttpResponse.json({ deleted: defaultMemoriaList.items.length })),
  http.post(`${API_BASE_URL}/api/memoria/import`, () => HttpResponse.json(defaultMemoriaImport)),
  http.post(`${API_BASE_URL}/api/memoria/flags`, () => HttpResponse.json({ ok: true })),
  http.post(`${API_BASE_URL}/api/memoria/delete`, () => HttpResponse.json({ ok: true })),
  http.post(`${API_BASE_URL}/api/memoria/update`, () => HttpResponse.json({ ok: true })),
  http.post(`${API_BASE_URL}/api/memoria/capture`, () => HttpResponse.json({ ok: true })),
  http.get(`${API_BASE_URL}/api/memoria/notice`, () => HttpResponse.json(defaultMemoriaNotice)),
  http.post(`${API_BASE_URL}/api/memoria/notice`, async ({ request }) => {
    const body = (await request.json()) as { dismissed: boolean };
    return HttpResponse.json({ dismissed: body.dismissed });
  }),
  http.get(`${API_BASE_URL}/api/personalization`, () => HttpResponse.json(defaultPersonalization)),
  http.put(`${API_BASE_URL}/api/personalization`, async ({ request }) => {
    const body = (await request.json()) as Partial<PersonalizationResponseFixture>;
    return HttpResponse.json({ ...defaultPersonalization, ...body, updated_at: "2026-07-08T00:00:00Z" });
  }),
  http.delete(`${API_BASE_URL}/api/personalization`, () => HttpResponse.json({ ok: true })),
  http.get(`${API_BASE_URL}/api/i18n`, () => HttpResponse.json(defaultI18nState)),
  http.put(`${API_BASE_URL}/api/i18n`, async ({ request }) => {
    const body = (await request.json()) as { locale: string };
    const match = defaultI18nState.available.find((bundle) => bundle.code === body.locale);
    if (!match) {
      return HttpResponse.json({ detail: "unknown locale" }, { status: 422 });
    }
    return HttpResponse.json({
      ...defaultI18nState,
      persisted_locale: match.code,
      pending_restart: match.code !== defaultI18nState.active_locale
    });
  }),
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
  http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(defaultLlmProvider)),
  http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
    const body = (await request.json()) as {
      active_provider?: string;
      fallback_mode?: "auto" | "manual";
      pregen_enabled?: boolean;
      profile_id?: string;
      base_url?: string | null;
      model?: string | null;
      preset?: string | null;
      api_key?: string;
      delete_profile?: string | null;
    };
    const profiles = { ...defaultLlmProvider.profiles };
    // delete_profile action (owner amendment 2026-07-24) — removes the profile
    // entry + its stored key. Mutually exclusive with profile edits; may combine
    // with an active_provider switch in the same PUT (switch-then-delete).
    if (body.delete_profile) {
      delete profiles[body.delete_profile];
      return HttpResponse.json({
        active_provider: body.active_provider ?? defaultLlmProvider.active_provider,
        fallback_mode: body.fallback_mode ?? defaultLlmProvider.fallback_mode,
        pregen_enabled: body.pregen_enabled ?? defaultLlmProvider.pregen_enabled,
        profiles
      });
    }
    if (body.profile_id) {
      const prev = profiles[body.profile_id] ?? { base_url: "", model: "", preset: "", api_key_set: false };
      const next = { ...prev };
      // F5: mirrors opencohost/api/main.py::put_llm_provider's preset-prefill
      // order — a preset fills an EMPTY base_url/model on the STORED profile
      // first; only then does an explicit (non-null) base_url/model in this
      // SAME request overwrite it. LLM_PROVIDER_PRESET_MODELS mirrors
      // settings.py::LLM_PROVIDER_PRESETS's models[0] (server picks the first
      // curated model) — mock-only, since the client mirror only carries
      // {label, base_url}. ponytail: keep in sync manually.
      if (body.preset) {
        if (!next.base_url) next.base_url = LLM_PROVIDER_PRESETS[body.preset]?.base_url ?? "";
        if (!next.model) next.model = LLM_PROVIDER_PRESET_MODELS[body.preset] ?? "";
      }
      if (body.base_url !== undefined && body.base_url !== null) next.base_url = body.base_url;
      if (body.model !== undefined && body.model !== null) next.model = body.model;
      if (body.preset !== undefined) next.preset = body.preset ?? "";
      if (body.api_key !== undefined) next.api_key_set = body.api_key !== "";
      profiles[body.profile_id] = next;
    }
    // R8: the response NEVER echoes an api_key — only api_key_set (recomputed above).
    return HttpResponse.json({
      active_provider: body.active_provider ?? defaultLlmProvider.active_provider,
      fallback_mode: body.fallback_mode ?? defaultLlmProvider.fallback_mode,
      pregen_enabled: body.pregen_enabled ?? defaultLlmProvider.pregen_enabled,
      profiles
    });
  }),
  // POST /api/llm/provider/probe (cloud_rearm_20260801 WU2) — default: cloud
  // arms immediately. Per-test overrides below cover armed:false and 503.
  http.post(`${API_BASE_URL}/api/llm/provider/probe`, () => HttpResponse.json({ armed: true, reason: null })),
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
  http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, () => HttpResponse.json(defaultStreamChatMessages)),
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
  http.post(`${API_BASE_URL}/api/music/mood`, async ({ request }) => {
    const body = (await request.json()) as { mood: string };
    const mood = (body.mood ?? "").trim().toLowerCase();
    if (!KNOWN_MOODS.includes(mood)) {
      return HttpResponse.json({ detail: "unknown mood" }, { status: 422 });
    }
    return HttpResponse.json({
      active_mood: mood,
      tracks: musicTracksForMood(defaultMusicLibrary, mood),
      suggested_track_id: suggestedTrackFor(defaultMusicLibrary, mood)
    });
  }),
  http.get(`${API_BASE_URL}/api/music/state`, () => HttpResponse.json(defaultMusicState)),
  http.post(`${API_BASE_URL}/api/music/fade`, async ({ request }) => {
    const body = (await request.json()) as { direction: string; duration_ms?: number };
    if (body.direction !== "in" && body.direction !== "out") {
      return HttpResponse.json({ detail: "unknown direction" }, { status: 422 });
    }
    return HttpResponse.json({
      active_mood: defaultMusicState.active_mood,
      fade: { direction: body.direction, duration_ms: body.duration_ms ?? 6000, seq: 1, ts: 0 }
    });
  }),
  http.post(`${API_BASE_URL}/api/music/import`, async ({ request }) => {
    const body = (await request.json()) as { path: string; mood: string };
    const mood = (body.mood ?? "").trim().toLowerCase();
    if (!KNOWN_MOODS.includes(mood)) {
      return HttpResponse.json({ detail: "unknown mood" }, { status: 422 });
    }
    const label = body.path.split(/[\\/]/).pop() ?? body.path;
    return HttpResponse.json({ track: { id: "track-imported", label, mood, status: "ok" } });
  }),
  http.delete(`${API_BASE_URL}/api/music/track/:id`, ({ params }) => {
    const id = decodeURIComponent(String(params.id));
    if (!defaultMusicLibrary.tracks.some((track) => track.id === id)) {
      return HttpResponse.json({ detail: "track not found" }, { status: 404 });
    }
    return HttpResponse.json({ ok: true });
  }),
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
  http.put(`${API_BASE_URL}/api/agenda/session`, () => HttpResponse.json(defaultAgenda)),
  http.post(`${API_BASE_URL}/api/agenda/session/action`, () => HttpResponse.json(defaultAgenda)),
  http.get(`${API_BASE_URL}/api/agenda/cohost-profiles`, () => HttpResponse.json(defaultCohostProfiles)),
  http.post(`${API_BASE_URL}/api/agenda/cohost-profiles`, async ({ request }) => {
    const body = (await request.json()) as { name: string; style: string; priority?: string; length?: string };
    const next: CohostProfilesResponse = {
      profiles: [
        ...defaultCohostProfiles.profiles.filter((profile) => profile.name !== body.name),
        cohostProfile({
          name: body.name,
          style: body.style,
          default_priority: body.priority ?? "normal",
          default_response_length: body.length ?? "normal"
        })
      ]
    };
    return HttpResponse.json(next);
  }),
  http.post(`${API_BASE_URL}/api/agenda/cohost-profiles/select`, async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({ selected: body.name });
  }),
  http.get(`${API_BASE_URL}/api/events`, () => HttpResponse.json(defaultEvents)),
  http.post(`${API_BASE_URL}/api/ptt/start`, () => HttpResponse.json(defaultPttStart)),
  http.post(`${API_BASE_URL}/api/ptt/keepalive`, async ({ request }) => {
    const body = (await request.json()) as { session_id: string };
    return HttpResponse.json({ session_id: body.session_id, state: "listening", buffered_chars: 12 });
  }),
  http.post(`${API_BASE_URL}/api/ptt/stop`, () => HttpResponse.json(defaultPttStop)),
  http.get(`${API_BASE_URL}/api/ptt/state`, () => HttpResponse.json(defaultPttState)),
  http.put(`${API_BASE_URL}/api/ptt/config`, async ({ request }) => {
    const body = (await request.json()) as { stt_ws_uri: string };
    return HttpResponse.json({ stt_ws_uri: body.stt_ws_uri });
  }),
  http.post(`${API_BASE_URL}/api/ptt/test`, () => HttpResponse.json({ ok: true, detail: "Conectado." }))
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

/** Per-test override: POST /api/perfiles rejected with 409 (name already exists). */
export function createPerfilConflictHandler(detail = "profile already exists") {
  return http.post(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json({ detail }, { status: 409 }));
}

/** Per-test override: POST /api/perfiles rejected with 422 (invalid name/prompt). */
export function createPerfilValidationHandler(detail = "invalid profile name") {
  return http.post(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: PUT /api/perfiles/:name rejected with 409 (new_name collision). */
export function updatePerfilConflictHandler(detail = "profile already exists") {
  return http.put(`${API_BASE_URL}/api/perfiles/:name`, () => HttpResponse.json({ detail }, { status: 409 }));
}

/** Per-test override: DELETE /api/perfiles/:name rejected with 409 — the
 * last-profile guard (opencohost/api/main.py::delete_perfil). */
export function deletePerfilLastProfileHandler(detail = "cannot delete the last profile") {
  return http.delete(`${API_BASE_URL}/api/perfiles/:name`, () => HttpResponse.json({ detail }, { status: 409 }));
}

/** Per-test override: DELETE /api/perfiles/:name rejected with 404 (unknown profile). */
export function deletePerfilNotFoundHandler(detail = "profile not found") {
  return http.delete(`${API_BASE_URL}/api/perfiles/:name`, () => HttpResponse.json({ detail }, { status: 404 }));
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
  // Mirrors `defaultStatus`'s shape (avatar_state omitted, see its comment)
  // while still letting a caller opt into supplying it via `initial`.
  let status: typeof defaultStatus & Partial<StatusResponse> = {
    ...defaultStatus,
    ...initial,
  };
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

/** Per-test override: GET /api/i18n returns a caller-supplied response
 * (e.g. a pending_restart:true state, or a different `available` list). */
export function i18nStateHandler(response: I18nStateResponseFixture) {
  return http.get(`${API_BASE_URL}/api/i18n`, () => HttpResponse.json(response));
}

/** Per-test override: PUT /api/i18n rejected with 422 (unknown locale). */
export function i18nSetLocaleValidationHandler(detail = "unknown locale") {
  return http.put(`${API_BASE_URL}/api/i18n`, () => HttpResponse.json({ detail }, { status: 422 }));
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

/** Per-test override: GET /api/llm/provider returns a caller-supplied response
 * (e.g. an active cloud profile, an incomplete draft, or a no-key profile). */
export function llmProviderGetHandler(response: LlmProviderResponseFixture) {
  return http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(response));
}

/** Per-test override: GET /api/llm/provider fails (generic 500). */
export function llmProviderGetErrorHandler() {
  return http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }));
}

/** Per-test override: GET /api/llm/provider 404 — the running backend predates
 * the route (older build). The card must show the "reopen the app" copy. */
export function llmProviderRouteMissingHandler(detail = "llm_provider_route_missing") {
  return http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json({ detail }, { status: 404 }));
}

/** Per-test override: PUT /api/llm/provider rejected with 422 — the activation
 * ladder / validation detail string (e.g. "api_key required for active cloud
 * profile", "invalid profile_id"). */
export function llmProviderValidationHandler(detail = "api_key required for active cloud profile") {
  return http.put(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: PUT /api/llm/provider rejected with 503 (key_store_write_failed
 * or provider_config_write_failed). */
export function llmProviderWriteFailedHandler(detail = "key_store_write_failed") {
  return http.put(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/** Per-test override: PUT /api/llm/provider captures the request body for
 * assertions (mirrors agendaSessionCaptureHandler). */
export function llmProviderPutCaptureHandler(
  capture: { body?: unknown },
  response: LlmProviderResponseFixture = defaultLlmProvider
) {
  return http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
    capture.body = await request.json();
    return HttpResponse.json(response);
  });
}

/** Per-test override: POST /api/llm/provider/probe returns armed:false with a
 * reason (e.g. `not_in_fallback`/`no_cloud_profile` no-ops, or a race where
 * cloud already recovered before the click landed) — a benign 200, not an error. */
export function llmProviderProbeArmedFalseHandler(reason: string) {
  return http.post(`${API_BASE_URL}/api/llm/provider/probe`, () => HttpResponse.json({ armed: false, reason }));
}

/** Per-test override: POST /api/llm/provider/probe rejected with 503
 * (motor_unavailable — the engine method is missing on an older build). */
export function llmProviderProbeUnavailableHandler() {
  return http.post(`${API_BASE_URL}/api/llm/provider/probe`, () =>
    HttpResponse.json({ detail: "motor_unavailable" }, { status: 503 })
  );
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

/** Per-test override: GET /api/stream/chat-live/messages returns 403 (no
 * operator token reached the backend). */
export function streamChatMessagesForbiddenHandler() {
  return http.get(`${API_BASE_URL}/api/stream/chat-live/messages`, () =>
    HttpResponse.json({ detail: "operator token required" }, { status: 403 })
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

/** Per-test override: POST /api/music/mood rejected with 422 (unknown mood). */
export function musicMoodValidationHandler(detail = "unknown mood") {
  return http.post(`${API_BASE_URL}/api/music/mood`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/music/mood fails at a non-422 status (e.g. 503 music_unavailable). */
export function musicMoodErrorHandler(status = 503, detail = "music_unavailable") {
  return http.post(`${API_BASE_URL}/api/music/mood`, () => HttpResponse.json({ detail }, { status }));
}

/** Per-test override: POST /api/music/mood returns a caller-supplied response
 * (e.g. a multi-track bucket to exercise client-side rotation, or an empty
 * bucket to exercise the suggested_track_id fallback). */
export function musicMoodHandler(response: MusicMoodResponse) {
  return http.post(`${API_BASE_URL}/api/music/mood`, () => HttpResponse.json(response));
}

/** Per-test override: GET /api/music/state returns a caller-supplied response. */
export function musicStateGetHandler(response: MusicStateResponse) {
  return http.get(`${API_BASE_URL}/api/music/state`, () => HttpResponse.json(response));
}

/** Per-test override: POST /api/music/fade rejected with 422 (unknown direction / out-of-range duration). */
export function musicFadeValidationHandler(detail = "unknown direction") {
  return http.post(`${API_BASE_URL}/api/music/fade`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/music/import returns a caller-supplied response. */
export function musicImportHandler(response: MusicImportResponse) {
  return http.post(`${API_BASE_URL}/api/music/import`, () => HttpResponse.json(response));
}

/** Per-test override: POST /api/music/import rejected with 422 (unknown mood / invalid path). */
export function musicImportValidationHandler(detail = "invalid path") {
  return http.post(`${API_BASE_URL}/api/music/import`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/music/import fails with 503 (music_write_failed — the disk copy itself failed). */
export function musicImportErrorHandler(detail = "music_write_failed") {
  return http.post(`${API_BASE_URL}/api/music/import`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/** Per-test override: DELETE /api/music/track/:id rejected with 404 (unknown/already-deleted track). */
export function musicTrackDeleteNotFoundHandler(detail = "track not found") {
  return http.delete(`${API_BASE_URL}/api/music/track/:id`, () => HttpResponse.json({ detail }, { status: 404 }));
}

/** Per-test override: DELETE /api/music/track/:id fails with 503 (music_write_failed — unlink itself failed). */
export function musicTrackDeleteErrorHandler(detail = "music_write_failed") {
  return http.delete(`${API_BASE_URL}/api/music/track/:id`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/**
 * Per-test override pair simulating a real DELETE -> refetch cycle: GET
 * /api/music/library keeps returning the full `library` until the matching
 * DELETE succeeds, then serves `library` with `trackId` removed — so a
 * component test that invalidates the library query after a successful
 * delete sees the track actually disappear, without any shared mutable
 * module state leaking across tests.
 */
export function musicLibraryDeleteFlowHandlers(library: MusicLibraryResponse, trackId: string) {
  let deleted = false;
  return [
    http.get(`${API_BASE_URL}/api/music/library`, () => {
      if (!deleted) {
        return HttpResponse.json(library);
      }
      const tracks = library.tracks.filter((track) => track.id !== trackId);
      return HttpResponse.json({
        tracks,
        count: tracks.length,
        moods: Array.from(new Set(tracks.map((track) => track.mood)))
      });
    }),
    http.delete(`${API_BASE_URL}/api/music/track/${trackId}`, () => {
      deleted = true;
      return HttpResponse.json({ ok: true });
    })
  ];
}

/** Per-test override: GET /api/agenda returns a caller-supplied response (e.g. an empty queue). */
export function agendaGetHandler(response: AgendaResponse) {
  return http.get(`${API_BASE_URL}/api/agenda`, () => HttpResponse.json(response));
}

/** Per-test override: GET /api/agenda fails (agenda unavailable / 503, or any other failure). */
export function agendaGetErrorHandler(status = 503, detail = "agenda_unavailable") {
  return http.get(`${API_BASE_URL}/api/agenda`, () => HttpResponse.json({ detail }, { status }));
}

/**
 * Per-test override simulating the agenda advancing between polls: GET
 * /api/agenda keeps returning `before` for `flipAfterCalls` requests, then
 * flips to `after` on every call after that — the agenda analog of
 * evolvingLastReplyHandler, used to drive useAgendaEvents' snapshot diffing.
 */
export function evolvingAgendaHandler(before: AgendaResponse, after: AgendaResponse, flipAfterCalls: number) {
  let calls = 0;
  return http.get(`${API_BASE_URL}/api/agenda`, () => {
    calls += 1;
    return HttpResponse.json(calls > flipAfterCalls ? after : before);
  });
}

/** Per-test override: POST /api/agenda/topic rejected with 422 (e.g. sanitize_topic_text failure). */
export function agendaTopicValidationHandler(detail = "invalid topic") {
  return http.post(`${API_BASE_URL}/api/agenda/topic`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/agenda/topic captures the request body for
 * assertions (WU7 — the only capture variant this endpoint lacked; mirrors
 * agendaSessionCaptureHandler). */
export function agendaTopicCaptureHandler(capture: { body?: unknown }, response: AgendaResponse = defaultAgenda) {
  return http.post(`${API_BASE_URL}/api/agenda/topic`, async ({ request }) => {
    capture.body = await request.json();
    return HttpResponse.json(response);
  });
}

/** Per-test override: POST /api/agenda/topic/action rejected (e.g. agenda unavailable). */
export function agendaTopicActionErrorHandler(status = 503, detail = "agenda_unavailable") {
  return http.post(`${API_BASE_URL}/api/agenda/topic/action`, () => HttpResponse.json({ detail }, { status }));
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

/** Per-test override: POST /api/agenda/session/action captures the request body for assertions. */
export function agendaSessionActionCaptureHandler(
  capture: { body?: unknown },
  response: AgendaResponse = defaultAgenda
) {
  return http.post(`${API_BASE_URL}/api/agenda/session/action`, async ({ request }) => {
    capture.body = await request.json();
    return HttpResponse.json(response);
  });
}

/** Per-test override: POST /api/agenda/session/action rejected with 503 (agenda_unavailable). */
export function agendaSessionActionErrorHandler(status = 503, detail = "agenda_unavailable") {
  return http.post(`${API_BASE_URL}/api/agenda/session/action`, () => HttpResponse.json({ detail }, { status }));
}

/**
 * Per-test override: POST /api/agenda/session/action returns the CTK-parity
 * empty-queue outcome (FIX-C) — 200 with applied=false, reason="empty_queue",
 * and state OFF (enable refused because nothing is queued/active).
 */
export function agendaSessionActionEmptyQueueHandler() {
  return http.post(`${API_BASE_URL}/api/agenda/session/action`, () =>
    HttpResponse.json({ ...defaultAgenda, state: "OFF", applied: false, reason: "empty_queue" })
  );
}

/** Per-test override: GET /api/agenda/cohost-profiles returns a caller-supplied response. */
export function cohostProfilesGetHandler(response: CohostProfilesResponse) {
  return http.get(`${API_BASE_URL}/api/agenda/cohost-profiles`, () => HttpResponse.json(response));
}

/** Per-test override: POST /api/agenda/cohost-profiles captures the request body for assertions. */
export function cohostProfileSaveCaptureHandler(
  capture: { body?: unknown },
  response: CohostProfilesResponse = defaultCohostProfiles
) {
  return http.post(`${API_BASE_URL}/api/agenda/cohost-profiles`, async ({ request }) => {
    capture.body = await request.json();
    return HttpResponse.json(response);
  });
}

/** Per-test override: POST /api/agenda/cohost-profiles rejected with 422 (empty profile name). */
export function cohostProfileSaveValidationHandler(detail = "empty profile name") {
  return http.post(`${API_BASE_URL}/api/agenda/cohost-profiles`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/agenda/cohost-profiles rejected with 503 (cohost_write_failed). */
export function cohostProfileSaveErrorHandler(detail = "cohost_write_failed") {
  return http.post(`${API_BASE_URL}/api/agenda/cohost-profiles`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/** Per-test override: POST /api/agenda/cohost-profiles/select captures the request body for assertions. */
export function cohostProfileSelectCaptureHandler(
  capture: { body?: unknown },
  response: CohostProfileSelectResponse = { selected: "Natural" }
) {
  return http.post(`${API_BASE_URL}/api/agenda/cohost-profiles/select`, async ({ request }) => {
    capture.body = await request.json();
    return HttpResponse.json(response);
  });
}

/** Per-test override: POST /api/agenda/cohost-profiles/select rejected with 404 (unknown profile). */
export function cohostProfileSelectNotFoundHandler(detail = "profile not found") {
  return http.post(`${API_BASE_URL}/api/agenda/cohost-profiles/select`, () =>
    HttpResponse.json({ detail }, { status: 404 })
  );
}

/** Per-test override: GET /api/memoria/row/{id} rejected with 404 (memoria not found / wrong profile). */
export function memoriaRowNotFoundHandler(detail = "memoria not found") {
  return http.get(`${API_BASE_URL}/api/memoria/row/:rowId`, () => HttpResponse.json({ detail }, { status: 404 }));
}

/** Per-test override: GET /api/memoria/row/{id} rejected with 503 (memoria_unavailable). */
export function memoriaRowUnavailableHandler(detail = "memoria_unavailable") {
  return http.get(`${API_BASE_URL}/api/memoria/row/:rowId`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/** Per-test override: counts every GET /api/memoria/row/{id} request while still
 * answering with the default fixture — lets a test prove the row endpoint was
 * NEVER hit while the list renders (content loads on-demand only). */
export function memoriaRowSpyHandler(counter: { calls: number }) {
  return http.get(`${API_BASE_URL}/api/memoria/row/:rowId`, ({ params }) => {
    counter.calls += 1;
    const row = defaultMemoriaRows[String(params.rowId)];
    if (!row) {
      return HttpResponse.json({ detail: "memoria not found" }, { status: 404 });
    }
    return HttpResponse.json(row);
  });
}

/** Per-test override: POST /api/memoria/flags rejected with 422 (no flags provided). */
export function memoriaFlagsValidationHandler(detail = "no flags provided") {
  return http.post(`${API_BASE_URL}/api/memoria/flags`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/memoria/flags rejected with 404 (memoria not found / wrong profile). */
export function memoriaFlagsNotFoundHandler(detail = "memoria not found") {
  return http.post(`${API_BASE_URL}/api/memoria/flags`, () => HttpResponse.json({ detail }, { status: 404 }));
}

/** Per-test override: POST /api/memoria/flags rejected with 503 (memoria_unavailable / memoria_write_failed). */
export function memoriaFlagsUnavailableHandler(detail = "memoria_unavailable") {
  return http.post(`${API_BASE_URL}/api/memoria/flags`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/** Per-test override: POST /api/memoria/delete rejected with 404 (memoria not found / wrong profile). */
export function memoriaDeleteNotFoundHandler(detail = "memoria not found") {
  return http.post(`${API_BASE_URL}/api/memoria/delete`, () => HttpResponse.json({ detail }, { status: 404 }));
}

/** Per-test override: POST /api/memoria/delete rejected with 503 (memoria_unavailable / memoria_write_failed). */
export function memoriaDeleteUnavailableHandler(detail = "memoria_unavailable") {
  return http.post(`${API_BASE_URL}/api/memoria/delete`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/** Per-test override: POST /api/memoria/update rejected with 422 (empty title/content, or exceeds max length). */
export function memoriaUpdateValidationHandler(detail = "title and content must not be empty") {
  return http.post(`${API_BASE_URL}/api/memoria/update`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/memoria/update rejected with 404 (memoria not found / wrong profile). */
export function memoriaUpdateNotFoundHandler(detail = "memoria not found") {
  return http.post(`${API_BASE_URL}/api/memoria/update`, () => HttpResponse.json({ detail }, { status: 404 }));
}

/** Per-test override: POST /api/memoria/update rejected with 503 (memoria_unavailable / memoria_write_failed). */
export function memoriaUpdateUnavailableHandler(detail = "memoria_unavailable") {
  return http.post(`${API_BASE_URL}/api/memoria/update`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/** Per-test override: GET /api/memoria/notice fails (surfaced as a generic ApiError). */
export function memoriaNoticeGetErrorHandler() {
  return http.get(`${API_BASE_URL}/api/memoria/notice`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }));
}

/** Per-test override: POST /api/memoria/import rejected with 422 (empty content,
 * oversize, too many items, source_label too long, or the profile already at
 * the import cap — the route's five 422 branches). */
export function memoriaImportValidationHandler(detail = "content must not be empty") {
  return http.post(`${API_BASE_URL}/api/memoria/import`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/memoria/import rejected with 503 (memoria_unavailable —
 * store down or the cap read itself failed). */
export function memoriaImportUnavailableHandler(detail = "memoria_unavailable") {
  return http.post(`${API_BASE_URL}/api/memoria/import`, () => HttpResponse.json({ detail }, { status: 503 }));
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

/** Per-test override: GET /api/events returns each entry of `responses` in
 * order (repeating the last one once exhausted) — mirrors evolvingStatusHandler,
 * used to script a deterministic poll sequence for useServerEventLog. */
export function eventsHandler(responses: EventLogResponse[]) {
  let calls = 0;
  return http.get(`${API_BASE_URL}/api/events`, () => {
    const body = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return HttpResponse.json(body);
  });
}

/** Per-test override: POST /api/ptt/start rejected with 503 stt_unreachable
 * (WhisperLive connect failed) — the hold must render this honestly and
 * NEVER show a fake "listening" state. */
export function pttStartUnreachableHandler(detail = "stt_unreachable") {
  return http.post(`${API_BASE_URL}/api/ptt/start`, () => HttpResponse.json({ detail }, { status: 503 }));
}

/** Per-test override: POST /api/ptt/start rejected with 409 session_active
 * (a session is already listening/flushing — single slot). */
export function pttStartConflictHandler(detail = "session_active") {
  return http.post(`${API_BASE_URL}/api/ptt/start`, () => HttpResponse.json({ detail }, { status: 409 }));
}

/** Per-test override: POST /api/ptt/keepalive rejected with 409 — the server
 * watchdog already guillotined this session (missed 3 beats); the client
 * reads this as "drop to idle". */
export function pttKeepaliveNotActiveHandler() {
  return http.post(`${API_BASE_URL}/api/ptt/keepalive`, () =>
    HttpResponse.json({ state: "idle", detail: "session_not_active" }, { status: 409 })
  );
}

/** Per-test override: POST /api/ptt/keepalive fails at the network level (no
 * response at all) — the watchdog finishes server-side regardless. */
export function pttKeepaliveNetworkErrorHandler() {
  return http.post(`${API_BASE_URL}/api/ptt/keepalive`, () => HttpResponse.error());
}

/** Per-test override: GET /api/ptt/state returns a caller-supplied response
 * (e.g. a fixed flushing/buffered_chars snapshot). */
export function pttStateHandler(response: PttStateResponse) {
  return http.get(`${API_BASE_URL}/api/ptt/state`, () => HttpResponse.json(response));
}

/** Per-test override: PUT /api/ptt/config rejected with 422 (bad scheme —
 * server only accepts ws:// or wss://). */
export function pttConfigValidationErrorHandler(detail = "stt_ws_uri must use ws:// or wss://") {
  return http.put(`${API_BASE_URL}/api/ptt/config`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: PUT /api/ptt/config succeeds with a caller-supplied
 * response (echoes back whatever URI the caller wants saved). */
export function pttConfigHandler(response: PttConfigResponse) {
  return http.put(`${API_BASE_URL}/api/ptt/config`, () => HttpResponse.json(response));
}

/** Per-test override: POST /api/ptt/test reports a specific ok/detail pair —
 * still 200 even for a failed probe (never an HTTP error). */
export function pttTestHandler(response: PttTestResponse) {
  return http.post(`${API_BASE_URL}/api/ptt/test`, () => HttpResponse.json(response));
}

/**
 * Per-test override: a stateful PTT session lifecycle across
 * start/keepalive/stop/state — mirrors commandDispatcherHandlers's
 * single-source-of-truth approach. GET /api/ptt/state stays "flushing" for
 * `flushTicks` polls after stop(), then converges to "idle", so a component
 * test can drive listening -> flushing -> idle without hand-wiring four
 * independent static handlers.
 */
export function pttSessionFlowHandlers(flushTicks = 1) {
  let flushing = false;
  let flushPolls = 0;
  return [
    http.post(`${API_BASE_URL}/api/ptt/start`, () => {
      flushing = false;
      flushPolls = 0;
      return HttpResponse.json(defaultPttStart);
    }),
    http.post(`${API_BASE_URL}/api/ptt/keepalive`, async ({ request }) => {
      const body = (await request.json()) as { session_id: string };
      return HttpResponse.json({ session_id: body.session_id, state: "listening", buffered_chars: 12 });
    }),
    http.post(`${API_BASE_URL}/api/ptt/stop`, () => {
      flushing = true;
      return HttpResponse.json({ state: "flushing" });
    }),
    http.get(`${API_BASE_URL}/api/ptt/state`, () => {
      if (!flushing) return HttpResponse.json(defaultPttState);
      flushPolls += 1;
      if (flushPolls >= flushTicks) {
        flushing = false;
        return HttpResponse.json(defaultPttState);
      }
      return HttpResponse.json({ state: "flushing", session_id: defaultPttStart.session_id, buffered_chars: 12, last_error: null });
    })
  ];
}
