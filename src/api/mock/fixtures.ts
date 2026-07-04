/**
 * Mock backend data for Controles domains that still have no endpoint
 * (Agenda, Avatar, OBS, Stream, Music below). Model registry / TTS config /
 * memory stats are wired to the real endpoints now — see src/api/models.ts,
 * src/api/tts.ts, src/api/memoria.ts.
 */

/**
 * Mock backend data for the Agenda domain. No /api/agenda* endpoint exists
 * yet — the real thing lives in opencohost/smart_aggregator/kira_agenda_
 * controller.py + opencohost/ui/cohost_agenda_panel.py, persisted to
 * EDITORIAL_CARDS_DB sqlite. Shape mirrors the controller's AgendaTopic /
 * suggestion / session-settings fields so a later hook swap (proposed:
 * GET /api/agenda, POST /api/agenda/{topic|suggestion|session}) is close to
 * a rename, not a reshape.
 */
export interface AgendaProfile {
  name: string;
  style: string;
}

export type AgendaRhythm = "calmo" | "normal" | "dinamico";
export type AgendaSafetyMode = "live_safe" | "monologue" | "test";

export interface AgendaSessionSettings {
  max_turns_per_topic: number;
  rhythm: AgendaRhythm;
  safety_mode: AgendaSafetyMode;
}

export type AgendaPriority = "alta" | "normal" | "baja";
export type AgendaConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface AgendaQueueTopic {
  id: string;
  title: string;
  angle: string;
  priority: AgendaPriority;
}

export interface AgendaSuggestion {
  id: string;
  title: string;
  angle: string;
  confidence: AgendaConfidence;
  source: string;
}

export type AgendaSessionState = "off" | "active" | "paused";

export interface AgendaFixtureShape {
  profile: AgendaProfile;
  session_settings: AgendaSessionSettings;
  now: AgendaQueueTopic | null;
  queue: AgendaQueueTopic[];
  suggestions: AgendaSuggestion[];
  session_state: AgendaSessionState;
}

// Avatar domain is now wired to the real GET/PUT /api/avatar/config
// endpoint — see src/api/avatar.ts + src/components/AvatarCard.tsx. The
// mock fixture that used to live here is gone (S7).

/**
 * Mock backend data for the OBS domain. No /api/obs/* endpoint exists yet —
 * the real thing lives in opencohost/avatar/obs_client.py +
 * opencohost/ui/obs_lifecycle.py. Proposed endpoints: GET/PUT
 * /api/obs/config, POST /api/obs/test. host/port/password/source are
 * owner-supplied creds (USER-ASSIST) — password_set is a flag only, the
 * fixture never carries an actual password value.
 */
export interface ObsFixtureShape {
  enabled: boolean;
  host: string;
  port: number;
  source: string;
  password_set: boolean;
}

export const OBS_FIXTURE: ObsFixtureShape = {
  enabled: false,
  host: "localhost",
  port: 4455,
  source: "Kira Avatar",
  password_set: true
};

/**
 * Mock backend data for the Stream domain (RF3 "Chat en vivo" only — RF4's
 * OAuth/metadata/moderación panels stay unbuilt, see StreamPanel's deferred
 * note). No /api/stream/* endpoint exists yet — the real thing lives in
 * opencohost/ui/stream_admin_ui.py's 'acciones' subtab, wired to
 * smart_agg.set_activity_limits (reaction threshold + cooldown),
 * set_spam_limits (max msgs/user/30s), set_filter_policy, and
 * sanitize_live_url for the connect URL. Proposed endpoints: GET
 * /api/stream/chat-live, POST /api/stream/chat-live/connect, PUT
 * /api/stream/chat-live/limits. reaction_threshold/cooldown/spam_limit and
 * their preset values mirror the CTK panel's real defaults and preset
 * buttons (0.5/1/3 msg/s, 30/60/120s, input_contract off by default per
 * chat_input_contract.USE_INPUT_CONTRACT_PROMPT) — spam_limit simplifies the
 * CTK's two spam params (max_messages_per_user, user_window_seconds) to a
 * single count since the window is fixed at 30s in the current UI.
 */
export type StreamPresetLevel = "bajo" | "medio" | "alto";

export interface StreamPresetOption {
  level: StreamPresetLevel;
  label: string;
}

export interface StreamFixtureShape {
  connected: boolean;
  url: string;
  reaction_threshold: string;
  cooldown: string;
  spam_limit: string;
  input_contract: boolean;
  presets: StreamPresetOption[];
}

export const STREAM_FIXTURE: StreamFixtureShape = {
  connected: false,
  url: "",
  reaction_threshold: "1",
  cooldown: "45",
  spam_limit: "10",
  input_contract: false,
  presets: [
    { level: "bajo", label: "Bajo" },
    { level: "medio", label: "Medio" },
    { level: "alto", label: "Alto" }
  ]
};

export const AGENDA_FIXTURE: AgendaFixtureShape = {
  profile: {
    name: "Natural",
    style:
      "Soná como co-host natural de stream: cercana, con humor seco, sin anunciar estructura ni despedirte entre ideas."
  },
  session_settings: { max_turns_per_topic: 3, rhythm: "normal", safety_mode: "live_safe" },
  now: {
    id: "topic-now",
    title: "Mods como cultura popular en gaming",
    angle: "Comunidades chicas que terminan definiendo gustos enormes.",
    priority: "alta"
  },
  queue: [
    {
      id: "topic-1",
      title: "La nostalgia noventera en internet",
      angle: "Por qué volvemos a símbolos viejos cuando el presente pesa.",
      priority: "alta"
    },
    {
      id: "topic-2",
      title: "Streamers y burnout",
      angle: "Cuánto aguanta un cuerpo haciendo directos todos los días.",
      priority: "normal"
    },
    {
      id: "topic-3",
      title: "Colecciones digitales",
      angle: "Por qué juntamos cosas que no podemos tocar.",
      priority: "baja"
    }
  ],
  suggestions: [
    {
      id: "sugg-1",
      title: "IA generativa en overlays de stream",
      angle: "Dónde está la línea entre herramienta y reemplazo.",
      confidence: "HIGH",
      source: "entity:overlay"
    },
    {
      id: "sugg-2",
      title: "Por qué el chat repite memes viejos",
      angle: "Nostalgia colectiva a escala de comunidad.",
      confidence: "MEDIUM",
      source: "vibe"
    },
    {
      id: "sugg-3",
      title: "Speedruns y perfeccionismo",
      angle: "",
      confidence: "LOW",
      source: "transition"
    }
  ],
  session_state: "active"
};

/**
 * Mock backend data for the Música domain. No /api/music/* endpoint exists
 * yet — the real thing lives in opencohost/ui/music_panel.py +
 * opencohost/core/music_library.py (MusicLibrary, AudioBedEngine.
 * request_mood), persisted to MUSIC_CONFIG_FILE json. `moods` mirrors
 * MusicLibrary.KNOWN_MOODS exactly (order matters for parity — this is not a
 * curated subset). `status` mirrors the CTK's derived label: "ok" ==
 * MusicTrack with missing=False/invalid=False, "faltante" == missing=True
 * (file no longer at its path), "invalido" == invalid=True (wrong header/
 * extension). Proposed endpoints: GET /api/music/library, POST
 * /api/music/mood, POST /api/music/fade, POST /api/music/import, DELETE
 * /api/music/track/{id}.
 */
export type MusicMood = "normal" | "nostalgia" | "hype" | "tension" | "sad" | "calm" | "comedy" | "ending";
export type MusicTrackStatus = "ok" | "faltante" | "invalido";

export interface MusicTrackFixture {
  id: string;
  name: string;
  mood: MusicMood;
  status: MusicTrackStatus;
}

export interface MusicFixtureShape {
  moods: MusicMood[];
  tracks: MusicTrackFixture[];
}

export const MUSIC_FIXTURE: MusicFixtureShape = {
  moods: ["normal", "nostalgia", "hype", "tension", "sad", "calm", "comedy", "ending"],
  tracks: [
    { id: "track-1", name: "ambient_drift.mp3", mood: "calm", status: "ok" },
    { id: "track-2", name: "hype_intro.wav", mood: "hype", status: "ok" },
    { id: "track-3", name: "old_synth.mp3", mood: "nostalgia", status: "faltante" },
    { id: "track-4", name: "broken_file.wav", mood: "tension", status: "invalido" }
  ]
};
