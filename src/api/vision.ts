import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TKey } from "../i18n/t.js";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";
import { isVisionActivePhase, useVisionPhaseStore } from "../store/visionStore.js";

/**
 * Vision-on-demand endpoints (opencohost/api/routers/vision.py) are newer than
 * the OpenAPI snapshot, so this module is hand-typed, the same self-contained
 * pattern as src/api/speech.ts and src/api/pronunciation.ts.
 *
 * PRIVACY: the status/settings routes only carry flags and codes. Screenshots
 * and the description cross only the per-look route (`looks/{id}/thumbnails`),
 * from backend memory, in the query cache, until the look expires.
 */

export type VisionState = "off" | "starting" | "warming" | "ready" | "failed";

export interface VisionLastResult {
  /** Look id (V1.11); keys GET /api/vision/looks/{id}/thumbnails. */
  id?: string;
  outcome: string;
  capture_ms: number | null;
  describe_ms: number | null;
  at: string;
  frames_captured?: number;
  /** After near-duplicate compaction. */
  frames_sent?: number;
  /** "normal" | "text" | "clip"; absent on older backends. */
  mode?: string;
  self_capture_skipped?: number;
}

export interface VisionStatus {
  /** Added by V1.8; optional so an older backend still parses. */
  state?: VisionState;
  last_error?: string | null;
  model_loaded?: boolean;
  last_result?: VisionLastResult | null;
  daemon_state: string;
  model_installed: boolean | null;
  capture_available: boolean;
  armed: boolean;
  looking: boolean;
}

export type VisionSource = "local" | "chat_model" | "cloud_model";

export interface VisionSettings {
  enabled: boolean;
  look_on_ptt: boolean;
  capture_delay_s: number;
  /** V1.11 burst settings; optional so an older backend still parses. */
  frames?: number;
  frame_interval_s?: number;
  show_thumbnails?: boolean;
  /** Opt-in: send screen looks and pasted images straight to a vision-capable
   * cloud chat model instead of describing them locally. Absent on an older backend. */
  cloud_direct_allowed?: boolean;
  /** Where images are described: on this PC, by the cloud chat model, or by a
   * separate cloud vision model. Absent on an older backend (read as "local"). */
  vision_source?: VisionSource;
  /** Provider preset id, model id and key choice of the separate cloud model. */
  vision_cloud_preset?: string;
  vision_cloud_model?: string;
  vision_cloud_use_chat_key?: boolean;
  rule_gate_enabled: boolean;
  model: string;
  port: number;
  describe_timeout_s: number;
}

export interface VisionResponse extends VisionSettings {
  status: VisionStatus;
  /** True when the cloud vision model has its own stored key. The key is never returned. */
  vision_cloud_key_set?: boolean;
  /** True when a chat provider profile with the same preset has a stored key. */
  vision_cloud_chat_key_set?: boolean;
  /** How many images one chat message may carry (backend `chat_image.MAX_IMAGES`,
   * runtime-fixes-20261110 T7). Absent on an older backend. */
  max_images?: number;
}

/** What the composer allows when the backend does not report a limit: an older
 * backend only understands the single `image` field. */
export const MAX_IMAGES_FALLBACK = 1;

export function visionMaxImages(data: VisionResponse | undefined): number {
  const value = data?.max_images;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : MAX_IMAGES_FALLBACK;
}

/** PUT body. `vision_cloud_api_key` is WRITE-ONLY ("" clears it): it never
 * enters the query cache and is scrubbed off the retained mutation variables. */
export type VisionUpdate = Partial<VisionSettings> & { vision_cloud_api_key?: string };

export interface VisionFieldError {
  field: string;
  code: string;
}

/** 422 `{detail: "invalid_vision_settings", errors: [{field, code}]}`. */
export class VisionValidationError extends ApiError {
  readonly errors: VisionFieldError[];
  constructor(errors: VisionFieldError[]) {
    super("invalid vision settings", 422);
    this.name = "VisionValidationError";
    this.errors = errors;
  }
}

/** 409 `vision_disabled`: a look was requested while vision is off. */
export class VisionDisabledError extends ApiError {
  constructor() {
    super("vision disabled", 409);
    this.name = "VisionDisabledError";
  }
}

const PATH = "/api/vision";

export async function getVision(): Promise<VisionResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`);
  if (!res.ok) {
    throw new ApiError(`GET ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as VisionResponse;
}

export async function putVision(updates: VisionUpdate): Promise<VisionResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  });
  if (res.status === 422) {
    let errors: VisionFieldError[] = [];
    try {
      const parsed = (await res.json()) as { errors?: unknown };
      if (Array.isArray(parsed.errors)) errors = parsed.errors as VisionFieldError[];
    } catch {
      // non-JSON 422 body: surface the typed error with no field detail
    }
    throw new VisionValidationError(errors);
  }
  if (!res.ok) {
    throw new ApiError(`PUT ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as VisionResponse;
}

/** V1.26/V1.27: `mode` picks the clip mosaic or the full-quality text frame. */
export async function lookNow(mode?: "clip" | "text"): Promise<{ armed: boolean }> {
  const init: RequestInit = mode
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) }
    : { method: "POST" };
  const res = await authFetch(`${getApiBaseUrl()}${PATH}/look`, init);
  if (res.status === 409) {
    throw new VisionDisabledError();
  }
  if (!res.ok) {
    throw new ApiError(`POST ${PATH}/look failed with ${res.status}`, res.status);
  }
  return (await res.json()) as { armed: boolean };
}

/** 404: the look is unknown or expired, or thumbnails are off. */
export class ThumbnailUnavailableError extends ApiError {
  constructor() {
    super("thumbnails unavailable", 404);
    this.name = "ThumbnailUnavailableError";
  }
}

/** What the backend still holds for one look: the frames as sent to the vision
 * model (`data:image/jpeg;base64,...`) and, for the operator token only, the
 * model's description. Both expire together and are never persisted: callers
 * keep them only in the in-memory query cache. */
export interface VisionLook {
  thumbnails: string[];
  description: string | null;
}

/** Lazily fetches a look's frames and description. 404 = unknown or expired. */
export async function getVisionLook(id: string): Promise<VisionLook> {
  const path = `${PATH}/looks/${encodeURIComponent(id)}/thumbnails`;
  const res = await authFetch(`${getApiBaseUrl()}${path}`);
  if (res.status === 404) throw new ThumbnailUnavailableError();
  if (!res.ok) throw new ApiError(`GET ${path} failed with ${res.status}`, res.status);
  const body = (await res.json()) as { thumbnails?: unknown; description?: unknown };
  return {
    thumbnails: Array.isArray(body.thumbnails) ? body.thumbnails.filter((t): t is string => typeof t === "string") : [],
    description: typeof body.description === "string" && body.description ? body.description : null
  };
}

export async function getVisionThumbnails(id: string): Promise<string[]> {
  return (await getVisionLook(id)).thumbnails;
}

/** What the UI should believe about readiness. `off` is the owner switch
 * (settings.enabled); otherwise the backend `state`, with a derivation from
 * `daemon_state` for a backend that predates it. */
export function visionReadiness(data: VisionResponse | undefined): VisionState {
  if (!data || !data.enabled) return "off";
  const s = data.status;
  if (s.state && s.state !== "off") return s.state;
  if (s.daemon_state === "running") return "ready";
  if (s.daemon_state === "failed") return "failed";
  return "starting";
}

/** What the composer indicator shows. `starting` folds the backend's `starting`
 * (daemon coming up) and `warming` (model loading); `ready` is the backend's
 * `ready`, which it only reports while the model is resident. */
export interface VisionComposerState {
  phase: "off" | "starting" | "ready" | "error";
  /** Enum code from `status.last_error` when phase is `error`; never free text. */
  reason: string | null;
}

export function visionComposerState(data: VisionResponse | undefined): VisionComposerState {
  const readiness = visionReadiness(data);
  if (readiness === "off") return { phase: "off", reason: null };
  if (readiness === "ready") return { phase: "ready", reason: null };
  if (readiness === "failed") return { phase: "error", reason: data?.status.last_error ?? null };
  return { phase: "starting", reason: null };
}

const VISION_REASON_CODES = new Set([
  "black_frame",
  "self_capture",
  "capture_unavailable",
  "describe_timeout",
  "describe_http",
  "describe_empty",
  "describe_cancelled",
  "describe_unavailable",
  "daemon_not_ready",
  "model_warming",
  "model_missing",
  "warm_failed",
  "port_in_use",
  "ollama_not_found",
  "spawn_failed",
  "process_exited_early",
  "startup_timeout",
  "error"
]);

/** Friendly-copy key for an outcome / last_error code; unknown codes (the
 * backend vocabulary may grow) get a generic line, never the raw code. */
export function visionReasonKey(code: string | null | undefined): TKey {
  return code && VISION_REASON_CODES.has(code)
    ? (`experiencia.vision.reason.${code}` as TKey)
    : "experiencia.vision.reason.unknown";
}

export const VISION_QUERY_KEY = ["vision"] as const;
export const VISION_MODELS_QUERY_KEY = ["vision", "models"] as const;

export interface VisionInstalledModel {
  tag: string;
  /** null = capability could not be verified. */
  vision: boolean | null;
  size_bytes: number | null;
}

export interface VisionSuggestedModel {
  tag: string;
  display: string;
  size_gb: number;
  desc: string;
}

export type VisionBenchVerdict = "recommended" | "light" | "broken";

export interface VisionBenchmark {
  verdict: VisionBenchVerdict;
  vram_gib: number | null;
  describe_s: number | null;
  spanish: boolean | null;
  note: string;
  measured_on: string;
}

/** GET /api/vision/models (hand-typed: newer than the OpenAPI snapshot). */
export interface VisionModelsResponse {
  current: string;
  installed: VisionInstalledModel[];
  suggested: VisionSuggestedModel[];
  ollama_reachable: boolean;
  /** Per-tag benchmark; absent tags have none. Optional: older backends omit it. */
  benchmarks?: Record<string, VisionBenchmark>;
}

export async function getVisionModels(): Promise<VisionModelsResponse> {
  const path = `${PATH}/models`;
  const res = await authFetch(`${getApiBaseUrl()}${path}`);
  if (!res.ok) throw new ApiError(`GET ${path} failed with ${res.status}`, res.status);
  return (await res.json()) as VisionModelsResponse;
}

/** No polling: refetches on window focus; downloads completing and model
 * changes invalidate it explicitly. */
export function useVisionModelsQuery() {
  return useQuery({
    queryKey: VISION_MODELS_QUERY_KEY,
    queryFn: getVisionModels,
    refetchOnWindowFocus: true
  });
}

const POLL_ACTIVE_MS = 1000;
const POLL_IDLE_MS = 5000;

/** Polls GET /api/vision: ~1s while a look is armed or in flight (drives the
 * "Kira is looking" indicator), slow otherwise. Stops with the component. */
export function useVisionQuery() {
  return useQuery({
    queryKey: VISION_QUERY_KEY,
    queryFn: getVision,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      const transitional = s?.state === "starting" || s?.state === "warming";
      return s && (s.armed || s.looking || transitional) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    },
    refetchIntervalInBackground: true
  });
}

/** Reads `status.looking` from the cache only (never fetches): the composer
 * look control already polls GET /api/vision and the `vision_looking` event
 * writes the flag, so the avatar can follow it without another request. */
export function useVisionLooking(): boolean {
  // The phase store (fed by vision events) keeps the pose through describing,
  // when a status poll may already report looking=false.
  const phaseActive = useVisionPhaseStore((s) => isVisionActivePhase(s.phase));
  const { data } = useQuery({
    queryKey: VISION_QUERY_KEY,
    queryFn: getVision,
    enabled: false,
    select: (d: VisionResponse) => d.status.looking === true
  });
  return data === true || phaseActive;
}

const THUMBNAIL_GC_MS = 30_000;

/** In-memory only (no persistence); dropped 30 s after the badge collapses.
 * One cache entry per look serves both the frames and the description. */
export function useVisionLook(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["vision", "thumbnails", id] as const,
    queryFn: () => getVisionLook(id as string),
    enabled: enabled && Boolean(id),
    retry: false,
    staleTime: Infinity,
    gcTime: THUMBNAIL_GC_MS
  });
}

export function useVisionThumbnails(id: string | undefined, enabled: boolean) {
  const { data, ...rest } = useVisionLook(id, enabled);
  return { data: data?.thumbnails, ...rest };
}

/** Partial settings save with an optimistic cache update and rollback on error. */
export function useVisionUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putVision,
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: VISION_QUERY_KEY });
      const previous = queryClient.getQueryData<VisionResponse>(VISION_QUERY_KEY);
      if (previous) {
        const { vision_cloud_api_key: _secret, ...visible } = updates;
        queryClient.setQueryData<VisionResponse>(VISION_QUERY_KEY, { ...previous, ...visible });
      }
      return { previous };
    },
    onError: (_error, _updates, context) => {
      if (context?.previous) queryClient.setQueryData(VISION_QUERY_KEY, context.previous);
    },
    onSettled: (_data, _error, variables) => {
      if ("vision_cloud_api_key" in variables) delete variables.vision_cloud_api_key;
    },
    onSuccess: (saved, updates) => {
      queryClient.setQueryData(VISION_QUERY_KEY, saved);
      if (updates.model !== undefined) void queryClient.invalidateQueries({ queryKey: VISION_MODELS_QUERY_KEY });
    }
  });
}

/** Arms the one-shot look, then refreshes status so the armed state shows. */
export function useLookNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: "clip" | "text" | void) => lookNow(mode || undefined),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: VISION_QUERY_KEY });
    }
  });
}
