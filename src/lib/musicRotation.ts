import type { MusicMoodResponse, MusicTrackOut } from "../api/music.js";

/**
 * Track-rotation policy, shared by the Música panel and the command palette.
 *
 * It lives in `lib/` rather than inside `MusicPanel.tsx` because the palette is
 * its second consumer: importing it from the panel dragged that whole module —
 * and with it `api/music`, `api/mock/*`, `state/PlaybackProvider` and four `ui/*`
 * components — into the palette's graph for the sake of two React-free
 * functions. There is nothing presentational here.
 */

/** Random pick from `bucket` that avoids replaying `currentTrackId`. If the
 * current track is the only one in the bucket, replaying it is the only
 * option — avoid-current is best-effort, not a hard guarantee. */
function rotate(bucket: MusicTrackOut[], currentTrackId: string | null): string {
  const candidates = bucket.filter((track) => track.id !== currentTrackId);
  const pool = candidates.length > 0 ? candidates : bucket;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

/**
 * Picks which track a mood click should play. When the mood bucket
 * (`result.tracks`, the full set of valid tracks the backend returned for the
 * mood) has entries, rotate over it — mirroring the desktop audio_bed's
 * rotation spirit. The backend (WU1) already populates `tracks` with its own
 * normal->any fallback pool when the mood has none, but this stays hardened
 * in case that invariant ever breaks: if `tracks` is still empty, rotate over
 * the caller's own known-valid ("ok" status) library instead of always
 * replaying the lone `suggested_track_id`. `suggested_track_id` is the last
 * resort, only if the library itself has no valid tracks. Stateless — the
 * only "state" is which track is playing right now, passed in as
 * `currentTrackId`.
 */
export function pickRotationTrack(
  result: MusicMoodResponse,
  currentTrackId: string | null,
  libraryTracks: MusicTrackOut[]
): string | null {
  if (result.tracks.length > 0) {
    return rotate(result.tracks, currentTrackId);
  }
  const validLibrary = libraryTracks.filter((track) => track.status === "ok");
  if (validLibrary.length > 0) {
    return rotate(validLibrary, currentTrackId);
  }
  return result.suggested_track_id;
}
