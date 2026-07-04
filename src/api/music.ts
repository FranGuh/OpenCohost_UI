import { useQuery } from "@tanstack/react-query";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

/**
 * GET /api/music/library (opencohost/api/main.py ~459) predates
 * types.gen.ts's OpenAPI generation, so it has no generated type —
 * hand-typed from opencohost/api/models.py::MusicLibraryResponse. READ-ONLY:
 * mood playback (POST /api/music/mood, /fade) and import/delete do not exist
 * yet on the backend — see MusicPanel.tsx for what stays a disabled mock.
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

export const MUSIC_LIBRARY_QUERY_KEY = ["music-library"] as const;

export async function getMusicLibrary(): Promise<MusicLibraryResponse> {
  const res = await fetch(`${BASE_URL}/api/music/library`);
  if (!res.ok) {
    throw new Error(`GET /api/music/library failed with ${res.status}`);
  }
  return (await res.json()) as MusicLibraryResponse;
}

export function useMusicLibraryQuery() {
  return useQuery({
    queryKey: MUSIC_LIBRARY_QUERY_KEY,
    queryFn: getMusicLibrary
  });
}
