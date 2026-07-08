import { useEffect } from "react";
import { useStatusQuery } from "../api/status.js";
import { usePlaybackContext } from "./PlaybackProvider.js";

/**
 * Bridges the live `GET /api/status` `is_speaking` flag into
 * PlaybackProvider's system-facing `ducked` flag, so the background music
 * bed automatically dips while Kira is talking and restores once she's done
 * (CTK parity: opencohost/core/audio_bed.py's speaking-duck behavior).
 *
 * Mount this INSIDE a PlaybackProvider (AppLayout does this) — it renders
 * nothing and exists purely to run the effect below; usePlaybackContext
 * throws if there's no provider above it.
 *
 * Deliberately reuses useStatusQuery's shared `["status"]` react-query cache
 * (already polled every 2s by other consumers, e.g. PlayerBar) instead of
 * opening a second poll — this adds zero extra network traffic. Note
 * useStatusQuery sets `refetchIntervalInBackground:false`, so while the
 * window/tab is unfocused the poll pauses and `ducked` stays frozen at
 * whatever it last was — acceptable, since there's no audience watching an
 * unfocused window's audio anyway.
 */
export function MusicDuckingWatcher() {
  const { data } = useStatusQuery();
  const { setDucked } = usePlaybackContext();

  useEffect(() => {
    setDucked(Boolean(data?.is_speaking));
  }, [data?.is_speaking, setDucked]);

  return null;
}
