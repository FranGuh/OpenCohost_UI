/**
 * Mock backend data for the Controles domains that have no endpoint yet
 * (model registry, TTS config, memory stats). P2: replace each fixture with
 * a TanStack Query hook reading the real endpoint — shape is deliberately
 * kept close to what those endpoints will return.
 */

export interface ModelCatalogEntry {
  id: string;
  name: string;
  size: string;
  vendor: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: "gemma-2b", name: "Gemma 4 (E2B) ⚡", vendor: "Google — optimizada para dispositivos y baja latencia.", size: "1.4 GB" },
  { id: "gemma-4b", name: "Gemma 4 (E4B)", vendor: "Google — más calidad, mayor uso de VRAM.", size: "2.6 GB" },
  { id: "llama3-8b", name: "LLaMA 3 (8B)", vendor: "Meta — balance entre calidad y velocidad.", size: "4.8 GB" },
  { id: "qwen3-1.7b", name: "Qwen 3 (1.7B)", vendor: "Alibaba — la más rápida del set.", size: "1.1 GB" }
];

export interface VoiceOption {
  id: string;
  label: string;
}

export interface EngineOption {
  id: string;
  label: string;
}

export const TTS_CONFIG = {
  voices: [
    { id: "ar", label: "AR Argentina" },
    { id: "neutral", label: "Neutral" },
    { id: "en-us", label: "English (US)" }
  ] as VoiceOption[],
  engines: [
    { id: "piper", label: "Piper (local)" },
    { id: "qwen3-tts", label: "Qwen3-TTS" }
  ] as EngineOption[]
};

export interface MemoryStats {
  session_turns: number;
  digest_entries: number;
  saved_memorias: number;
  pinned: number;
  editorial_cards_by_status: Record<string, number>;
}

export const MEMORY_STATS: MemoryStats = {
  session_turns: 14,
  digest_entries: 3,
  saved_memorias: 7,
  pinned: 5,
  editorial_cards_by_status: { draft: 1, published: 0, archived: 2 }
};

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
