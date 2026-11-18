import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authFetch, getApiBaseUrl, getTtsConfig, type TtsConfigResponse } from "./client.js";

export type TtsConfig = TtsConfigResponse;

export const TTS_CONFIG_QUERY_KEY = ["tts-config"] as const;

export function useTtsConfigQuery() {
  return useQuery({
    queryKey: TTS_CONFIG_QUERY_KEY,
    queryFn: ({ signal }) => getTtsConfig({ signal })
  });
}

// ---- Voice catalogs (voice-catalog-selection T5) -------------------------
// Hand-typed from opencohost/api/routers/i18n_tts.py (these routes post-date
// types.gen.ts). ponytail: keep in sync manually.

export interface PiperSpeaker {
  name: string;
  id: number;
}

export type PiperVoiceReason = "missing_config" | "invalid_config";

export interface PiperVoice {
  id: string;
  label: string;
  lang: string;
  num_speakers: number;
  speakers: PiperSpeaker[];
  sample_rate: number | null;
  bundled: boolean;
  status: "ok" | "incomplete";
  reason: PiperVoiceReason | null;
}

export interface EdgeVoice {
  id: string;
  label: string;
  locale: string;
  gender: string;
}

export interface EdgeVoicesResponse {
  voices: EdgeVoice[];
  /** `fallback` = offline, the bundle defaults are shown. */
  source: "live" | "cache" | "fallback";
}

export const PIPER_VOICES_QUERY_KEY = ["tts", "piper", "voices"] as const;
export const PIPER_FOLDER_QUERY_KEY = ["tts", "piper", "folder"] as const;
export const EDGE_VOICES_QUERY_KEY = ["tts", "edge", "voices"] as const;

export async function getPiperVoices(lang: string): Promise<PiperVoice[]> {
  const res = await fetch(`${getApiBaseUrl()}/api/tts/piper/voices?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) throw new ApiError(`GET /api/tts/piper/voices failed with ${res.status}`, res.status);
  return (await res.json()) as PiperVoice[];
}

export async function getEdgeVoices(lang: string): Promise<EdgeVoicesResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/tts/edge/voices?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) throw new ApiError(`GET /api/tts/edge/voices failed with ${res.status}`, res.status);
  return (await res.json()) as EdgeVoicesResponse;
}

export function usePiperVoicesQuery(lang: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...PIPER_VOICES_QUERY_KEY, lang],
    queryFn: () => getPiperVoices(lang),
    staleTime: 10_000,
    enabled: options.enabled ?? true
  });
}

export function useEdgeVoicesQuery(lang: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...EDGE_VOICES_QUERY_KEY, lang],
    queryFn: () => getEdgeVoices(lang),
    staleTime: 60_000,
    enabled: options.enabled ?? true
  });
}

export type PiperFolderSource = "saved" | "env" | "default";

export interface PiperFolderInfo {
  path: string;
  source: PiperFolderSource;
  exists: boolean;
  voice_count: number;
}

/** A refused folder choice; `code` is the server's stable enum (422/503 `detail`). */
export class PiperFolderError extends ApiError {
  readonly code: string;
  constructor(code: string, status: number) {
    super(code, status);
    this.name = "PiperFolderError";
    this.code = code;
  }
}

async function readFolderResponse(res: Response, what: string): Promise<PiperFolderInfo> {
  if (res.ok) return (await res.json()) as PiperFolderInfo;
  let code = "";
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") code = body.detail;
  } catch {
    // non-JSON error body: fall through to the generic error.
  }
  if (code) throw new PiperFolderError(code, res.status);
  throw new ApiError(`${what} failed with ${res.status}`, res.status);
}

export async function getPiperFolder(): Promise<PiperFolderInfo> {
  return readFolderResponse(await authFetch(`${getApiBaseUrl()}/api/tts/piper/folder`), "GET /api/tts/piper/folder");
}

export async function putPiperFolder(path: string): Promise<PiperFolderInfo> {
  const res = await authFetch(`${getApiBaseUrl()}/api/tts/piper/folder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path })
  });
  return readFolderResponse(res, "PUT /api/tts/piper/folder");
}

export async function deletePiperFolder(): Promise<PiperFolderInfo> {
  const res = await authFetch(`${getApiBaseUrl()}/api/tts/piper/folder`, { method: "DELETE" });
  return readFolderResponse(res, "DELETE /api/tts/piper/folder");
}

export function usePiperFolderQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: PIPER_FOLDER_QUERY_KEY,
    queryFn: getPiperFolder,
    staleTime: 10_000,
    enabled: options.enabled ?? true
  });
}

/** Set or reset the folder; the voice list is refetched at once (no restart). */
function useFolderMutation<V>(fn: (v: V) => Promise<PiperFolderInfo>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      queryClient.setQueryData(PIPER_FOLDER_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: PIPER_VOICES_QUERY_KEY });
    }
  });
}

export function useSetPiperFolderMutation() {
  return useFolderMutation<string>(putPiperFolder);
}

export function useResetPiperFolderMutation() {
  return useFolderMutation<void>(() => deletePiperFolder());
}
