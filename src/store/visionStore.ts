import { create } from "zustand";

/** Metadata-only record of one look attempt (`vision.vision_result` event).
 * PRIVACY: outcome code and timing only, never an image or a description. */
export interface VisionResult {
  id: string;
  /** Epoch ms (server event time) used to correlate with the next Kira reply. */
  ts: number;
  outcome: string;
  /** Filled from GET /api/vision `last_result` shortly after the event. */
  describeMs: number | null;
  /** Look id (GET /api/vision `last_result.id`); keys the thumbnails fetch. */
  lookId?: string | null;
  /** Frames the model saw, after near-duplicate compaction. */
  framesSent?: number | null;
  /** How the look was taken; absent on older backends. */
  mode?: VisionMode | null;
}

export type VisionMode = "normal" | "text" | "clip";

export function parseVisionMode(value: unknown): VisionMode | null {
  return value === "normal" || value === "text" || value === "clip" ? value : null;
}

export interface VisionLookDetails {
  describeMs?: number | null;
  lookId?: string | null;
  framesSent?: number | null;
  mode?: VisionMode | null;
}

export const VISION_RESULT_CAP = 50;

interface VisionResultState {
  results: VisionResult[];
  append(result: VisionResult): void;
  setLookDetails(id: string, details: VisionLookDetails): void;
}

export const useVisionResultStore = create<VisionResultState>((set) => ({
  results: [],
  append: (result) =>
    set((state) => {
      if (state.results.some((r) => r.id === result.id)) return state;
      const next = [...state.results, result];
      return { results: next.length > VISION_RESULT_CAP ? next.slice(next.length - VISION_RESULT_CAP) : next };
    }),
  setLookDetails: (id, details) =>
    set((state) => ({ results: state.results.map((r) => (r.id === id ? { ...r, ...details } : r)) }))
}));

/** Where the current look is: frames being captured, the VL model processing
 * them, or the last outcome. Fed by `vision.*` events (per webview window). */
export type VisionPhase = "idle" | "looking" | "describing" | "done" | "failed";

export function isVisionActivePhase(phase: VisionPhase): boolean {
  return phase === "looking" || phase === "describing";
}

interface VisionPhaseState {
  phase: VisionPhase;
  setPhase(phase: VisionPhase): void;
}

export const useVisionPhaseStore = create<VisionPhaseState>((set) => ({
  phase: "idle",
  setPhase: (phase) => set({ phase })
}));

/** One "I asked Kira to look but vision is off" moment (`vision.vision_off_request`
 * event). Carries no text: the backend never puts the owner's words in it. */
export interface VisionOffRequest {
  id: string;
  /** Epoch ms (server event time) so the feed row lands where it happened. */
  ts: number;
}

export const VISION_OFF_REQUEST_CAP = 20;

interface VisionOffRequestState {
  requests: VisionOffRequest[];
  append(request: VisionOffRequest): void;
}

export const useVisionOffRequestStore = create<VisionOffRequestState>((set) => ({
  requests: [],
  append: (request) =>
    set((state) => {
      if (state.requests.some((r) => r.id === request.id)) return state;
      const next = [...state.requests, request];
      return { requests: next.length > VISION_OFF_REQUEST_CAP ? next.slice(next.length - VISION_OFF_REQUEST_CAP) : next };
    })
}));
