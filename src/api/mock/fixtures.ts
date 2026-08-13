/**
 * Mock backend data for Controles domains that still have no endpoint
 * (Stream, Music below). Model registry / TTS config / memory stats /
 * Agenda / Avatar / OBS are wired to the real endpoints now — see
 * src/api/models.ts, src/api/tts.ts, src/api/memoria.ts, src/api/agenda.ts,
 * src/api/avatar.ts, src/api/obs.ts. The Agenda and OBS mock fixtures that
 * used to live here are gone (dead code removal, no remaining reference).
 */

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
  /** true = viewer chat outranks Kira's agenda; false = agenda first. */
  stream_over_agenda: boolean;
  /** Chosen TTL seconds (string, Select-bound) — mirrors reaction_threshold's
   * shape. Seeded at the backend's 300s floor so it starts in sync with
   * effective_stream_ttl_seconds. */
  stream_ttl_seconds: string;
  presets: StreamPresetOption[];
}

export const STREAM_FIXTURE: StreamFixtureShape = {
  connected: false,
  url: "",
  reaction_threshold: "1",
  cooldown: "45",
  spam_limit: "10",
  input_contract: false,
  stream_over_agenda: false,
  stream_ttl_seconds: "300",
  presets: [
    { level: "bajo", label: "Bajo" },
    { level: "medio", label: "Medio" },
    { level: "alto", label: "Alto" }
  ]
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
