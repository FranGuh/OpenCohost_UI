import { http, HttpResponse } from "msw";
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

// Mirrors src/api/client.ts's BASE_URL resolution exactly, so the mock
// handlers always match whatever base URL the app under test actually uses —
// immune to a developer's local .env.local overriding VITE_API_BASE_URL.
// Fallback kept in sync manually with client.ts::DEFAULT_API_BASE_URL.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765";

// active_profile_id mirrors src/api/client.ts's hand-added StatusResponse
// field (snapshot lag — types.gen.ts predates it). ponytail: keep in sync.
type StatusResponse = paths["/api/status"]["get"]["responses"][200]["content"]["application/json"] & {
  active_profile_id?: string | null;
};
type ProfilesResponse = paths["/api/perfiles"]["get"]["responses"][200]["content"]["application/json"];
type ModelsResponse = paths["/api/models"]["get"]["responses"][200]["content"]["application/json"];
type TtsConfigResponse = paths["/api/tts/config"]["get"]["responses"][200]["content"]["application/json"];
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
}

export const defaultStatus: StatusResponse = {
  is_ready: true,
  current_model: "qwen3-tts",
  is_speaking: false,
  is_processing: false,
  active_profile: "default",
  active_profile_id: "profile-id-default",
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
      inactive: false
    },
    {
      id: "mem_b",
      title: "Título memoria B",
      created_at: "2026-01-02T00:00:00+00:00",
      updated_at: "2026-01-02T00:00:00+00:00",
      revision: 2,
      pinned: false,
      private: true,
      inactive: false
    }
  ]
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
    inactive: false
  },
  mem_b: {
    id: "mem_b",
    title: "Título memoria B",
    content: "Contenido completo de la memoria B.",
    created_at: "2026-01-02T00:00:00+00:00",
    updated_at: "2026-01-02T00:00:00+00:00",
    pinned: false,
    private: true,
    inactive: false
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
  })
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
