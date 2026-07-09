import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, NotFoundError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * Music orchestration endpoints (opencohost/api/main.py ~906-1063) predate
 * types.gen.ts's OpenAPI generation, so they have no generated type —
 * hand-typed from opencohost/api/models.py. Design decision (resolution
 * 2911/2914): the API orchestrates state only and NEVER plays audio itself;
 * the Tauri client reads this state and plays tracks client-side via
 * `trackAudioUrl` (GET /api/music/track/{id}/audio, a FileResponse). A fade
 * is likewise only a recorded INTENT (POST /api/music/fade) — the client is
 * responsible for executing it.
 * ponytail: keep in sync manually until the snapshot is regenerated.
 */
export interface MusicTrackOut {
  id: string;
  label: string;
  mood: string;
  status: "ok" | "faltante" | "invalido";
}

export interface MusicLibraryResponse {
  tracks: MusicTrackOut[];
  count: number;
  moods: string[];
}

/** POST /api/music/mood body — `mood` is checked server-side against
 * KNOWN_MOODS (422 on unknown, opencohost/api/main.py::_normalize_mood_strict). */
export interface MusicMoodRequest {
  mood: string;
}

/** POST /api/music/mood response. No playback/audio field — the client reads
 * `suggested_track_id` (select_for_mood's mood->normal->any fallback) and the
 * valid `tracks` in the bucket, then plays client-side via `trackAudioUrl`.
 * `fallback` is true only when the requested mood had no tracks of its own
 * and the backend populated `tracks` from its normal->any fallback pool
 * instead (WU1, opencohost/api/models.py::MusicMoodResponse). Optional so
 * older backend responses (or hand-built test fixtures) without the field
 * still type-check. */
export interface MusicMoodResponse {
  active_mood: string;
  tracks: MusicTrackOut[];
  suggested_track_id: string | null;
  fallback?: boolean;
}

/** A recorded fade INTENT, carried on MusicStateResponse.fade so a polling
 * client can execute the fade when it sees a `seq` greater than its last. */
export interface MusicFadeOut {
  direction: "in" | "out";
  duration_ms: number;
  seq: number;
  ts: number;
}

/** POST /api/music/fade body. `direction` is checked against "in"|"out"
 * server-side (422 on unknown). `duration_ms` defaults server-side when
 * omitted, then range-capped — the fade is an INTENT the client executes. */
export interface MusicFadeRequest {
  direction: "in" | "out";
  duration_ms?: number;
}

/** GET /api/music/state (and the POST mood/fade responses). Orchestration
 * state ONLY — the API never plays audio; the client reads this and plays.
 * `fade` is null until a fade intent has been set. */
export interface MusicStateResponse {
  active_mood: string;
  fade: MusicFadeOut | null;
}

/** POST /api/music/import body. `path` is an absolute local audio file the
 * server copies into the managed library dir; `mood` is checked against
 * KNOWN_MOODS (422 on unknown). Client and server share a filesystem
 * (local-first product) — but the browser/webview <input type=file> cannot
 * surface a real filesystem path without the Tauri dialog plugin, which is
 * not installed yet, so this stays wired-but-unused from the UI for now. */
export interface MusicImportRequest {
  path: string;
  mood: string;
}

/** POST /api/music/import response. `track` carries NO filesystem `path`
 * (resolution 2914: audio is delivered only via the audio FileResponse
 * endpoint, so the raw path is never leaked to the client). */
export interface MusicImportResponse {
  track: MusicTrackOut;
}

/** DELETE /api/music/track/{id} has no `response_model` — hand-typed from
 * the literal `{"ok": True}` return, same pattern as SwitchAccepted. */
export interface DeleteMusicTrackResponse {
  ok: true;
}

export const MUSIC_LIBRARY_QUERY_KEY = ["music-library"] as const;
export const MUSIC_STATE_QUERY_KEY = ["music-state"] as const;

async function extractMusicDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body.detail ?? fallback;
  } catch {
    // non-JSON error body — fall back to a generic message instead of
    // letting res.json() throw an opaque SyntaxError.
    return fallback;
  }
}

export async function getMusicLibrary(): Promise<MusicLibraryResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/music/library`);
  if (!res.ok) {
    throw new ApiError(
      await extractMusicDetail(res, `GET /api/music/library failed with ${res.status}`),
      res.status
    );
  }
  return (await res.json()) as MusicLibraryResponse;
}

export function useMusicLibraryQuery() {
  return useQuery({
    queryKey: MUSIC_LIBRARY_QUERY_KEY,
    queryFn: getMusicLibrary
  });
}

/**
 * POST /api/music/mood — sets the active mood server-side (orchestration
 * only) and returns the valid tracks in that mood bucket plus a suggested
 * track id for the client to play. 422 when `mood` isn't one of KNOWN_MOODS.
 */
export async function postMusicMood(mood: string): Promise<MusicMoodResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/music/mood`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mood } satisfies MusicMoodRequest)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractMusicDetail(res, "unknown mood"));
  }
  if (!res.ok) {
    throw new ApiError(
      await extractMusicDetail(res, `POST /api/music/mood failed with ${res.status}`),
      res.status
    );
  }
  return (await res.json()) as MusicMoodResponse;
}

export function useMusicMoodMutation() {
  return useMutation({
    mutationFn: postMusicMood
  });
}

export async function getMusicState(): Promise<MusicStateResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/music/state`);
  if (!res.ok) {
    throw new ApiError(
      await extractMusicDetail(res, `GET /api/music/state failed with ${res.status}`),
      res.status
    );
  }
  return (await res.json()) as MusicStateResponse;
}

export function useMusicStateQuery() {
  return useQuery({
    queryKey: MUSIC_STATE_QUERY_KEY,
    queryFn: getMusicState
  });
}

/**
 * POST /api/music/fade — records a fade INTENT server-side; the API never
 * touches audio (headless host has no AudioBedEngine). The Tauri client is
 * responsible for executing the actual volume ramp against its own <audio>
 * element. 422 on an unknown direction or an out-of-range duration_ms.
 */
export async function postMusicFade(direction: "in" | "out", durationMs?: number): Promise<MusicStateResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/music/fade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction, duration_ms: durationMs } satisfies MusicFadeRequest)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractMusicDetail(res, "invalid fade request"));
  }
  if (!res.ok) {
    throw new ApiError(
      await extractMusicDetail(res, `POST /api/music/fade failed with ${res.status}`),
      res.status
    );
  }
  return (await res.json()) as MusicStateResponse;
}

export function useMusicFadeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ direction, durationMs }: { direction: "in" | "out"; durationMs?: number }) =>
      postMusicFade(direction, durationMs),
    onSuccess: (data) => {
      queryClient.setQueryData(MUSIC_STATE_QUERY_KEY, data);
    }
  });
}

/**
 * POST /api/music/import — copies a local audio file (absolute path, shared
 * filesystem, local-first product) into the managed library. 422 on an
 * unknown mood or an invalid/oversized/unsupported path, 503 if the copy
 * itself fails on disk.
 */
export async function postMusicImport(path: string, mood: string): Promise<MusicImportResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/music/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, mood } satisfies MusicImportRequest)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractMusicDetail(res, "invalid import request"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractMusicDetail(res, "music_write_failed"), 503);
  }
  if (!res.ok) {
    throw new ApiError(
      await extractMusicDetail(res, `POST /api/music/import failed with ${res.status}`),
      res.status
    );
  }
  return (await res.json()) as MusicImportResponse;
}

export function useMusicImportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, mood }: { path: string; mood: string }) => postMusicImport(path, mood),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MUSIC_LIBRARY_QUERY_KEY });
    }
  });
}

/**
 * DELETE /api/music/track/{id} — deregisters the track and unlinks its file
 * if it lives inside the managed library dir. 404 on an unknown/already
 * deleted id (repeat DELETE -> 404, mirrors delete_perfil), 503 if the
 * unlink itself fails.
 */
export async function deleteMusicTrack(trackId: string): Promise<DeleteMusicTrackResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/music/track/${encodeURIComponent(trackId)}`, {
    method: "DELETE"
  });
  if (res.status === 404) {
    throw new NotFoundError(await extractMusicDetail(res, "track not found"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractMusicDetail(res, "music_write_failed"), 503);
  }
  if (!res.ok) {
    throw new ApiError(
      await extractMusicDetail(res, `DELETE /api/music/track/${trackId} failed with ${res.status}`),
      res.status
    );
  }
  return (await res.json()) as DeleteMusicTrackResponse;
}

export function useDeleteMusicTrackMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (trackId: string) => deleteMusicTrack(trackId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MUSIC_LIBRARY_QUERY_KEY });
    }
  });
}

/**
 * Builds the client-side playback URL for a managed track (GET
 * /api/music/track/{id}/audio, a FileResponse) — never fetched directly by
 * this module, only assigned as an <audio> element's `src` so the Tauri
 * webview plays it (the API orchestrates, the client plays — resolution 2911).
 */
export function trackAudioUrl(trackId: string): string {
  return `${getApiBaseUrl()}/api/music/track/${encodeURIComponent(trackId)}/audio`;
}
