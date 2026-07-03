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
