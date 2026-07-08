import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { trackAudioUrl } from "../api/music.js";

export interface PlaybackContextValue {
  currentTrackId: string | null;
  playing: boolean;
  playTrack(id: string, label?: string): void;
  toggle(): void;
  stop(): void;
  /** User-facing music volume, 0-100 (persisted to localStorage). */
  volume: number;
  setVolume(value: number): void;
  /**
   * System-facing duck flag (CTK parity: audio_bed.py's speaking-duck). NOT
   * meant to be driven directly by end-user controls — it's set by
   * MusicDuckingWatcher from the live GET /api/status `is_speaking` flag so
   * the music bed dips automatically while Kira talks. Exposed on the
   * context (rather than kept private) so that watcher can live in its own
   * component instead of being wedged into this provider.
   */
  ducked: boolean;
  setDucked(value: boolean): void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const VOLUME_STORAGE_KEY = "oc-music-volume";
const DEFAULT_VOLUME = 70;

// CTK parity: opencohost/core/audio_bed.py's AudioBedPolicy defaults
// (base_volume=0.28, ducked_volume=0.08) -> ~0.286x while Kira speaks.
const DUCK_FRACTION = 0.3;

// Ramp the shared <audio> element's volume linearly over ~300ms instead of
// snapping it, so a duck/un-duck or a manual volume change doesn't click/pop.
// Uses setInterval (NOT requestAnimationFrame) specifically so fake timers
// (vi.useFakeTimers()) can drive it deterministically in tests.
const VOLUME_RAMP_MS = 300;
const VOLUME_RAMP_STEP_MS = 16;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampVolumePercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function readStoredVolume(): number {
  const stored = window.localStorage.getItem(VOLUME_STORAGE_KEY);
  if (stored === null) return DEFAULT_VOLUME;
  const parsed = Number(stored);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return DEFAULT_VOLUME;
  return parsed;
}

/**
 * Owns the single shared <audio> element for the whole app session (bug fix:
 * MusicPanel used to own it directly, so switching Sidebar sections unmounted
 * MusicPanel — and with it the <audio> element — killing playback mid-track).
 *
 * Mount this ABOVE the section-switched subtree (AppLayout's persistent
 * chrome), so the element's lifetime matches the session, not whichever
 * panel happens to be visible. The element is a plain `new Audio()` instance
 * held in a ref — it is never rendered into the JSX tree, so there is no DOM
 * node for a re-render/unmount elsewhere in the app to tear down.
 */
export function PlaybackProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current) {
    audioRef.current = new Audio();
  }

  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState<number>(() => readStoredVolume());
  const [ducked, setDucked] = useState(false);
  const rampIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnded = () => setPlaying(false);
    // Covers async decode/network failures that surface AFTER play() already
    // resolved (e.g. a 404/unsupported media type discovered mid-buffer) —
    // without this, `playing` stays stuck true with no visible audio.
    const handleError = () => setPlaying(false);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, []);

  // Ramps the shared element's volume toward (volume/100) * (ducked ? 0.3 : 1)
  // whenever either input changes. Storing the interval in a ref (rather than
  // only a local effect variable) means any change to `volume`/`ducked`
  // cancels whatever ramp was still in flight — via the effect cleanup below
  // — before starting the new one, so ramps never blend/race each other.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const target = clampUnit((volume / 100) * (ducked ? DUCK_FRACTION : 1));
    const start = audio.volume;
    const steps = Math.max(1, Math.round(VOLUME_RAMP_MS / VOLUME_RAMP_STEP_MS));
    let tick = 0;

    const intervalId = setInterval(() => {
      tick += 1;
      if (tick >= steps) {
        audio.volume = target; // snap exactly on the final tick — avoids
        // float drift from the interpolation formula pushing volume
        // fractionally outside [0,1], which jsdom's HTMLMediaElement (per
        // spec) rejects with an IndexSizeError.
        clearInterval(intervalId);
        rampIntervalRef.current = null;
        return;
      }
      audio.volume = clampUnit(start + (target - start) * (tick / steps));
    }, VOLUME_RAMP_STEP_MS);
    rampIntervalRef.current = intervalId;

    return () => {
      clearInterval(intervalId);
      rampIntervalRef.current = null;
    };
  }, [volume, ducked]);

  const setVolume = useCallback((value: number) => {
    const clamped = clampVolumePercent(value);
    setVolumeState(clamped);
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
  }, []);

  const playTrack = useCallback((id: string, label?: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = trackAudioUrl(id);
    // Apply the current effective (possibly ducked) volume immediately,
    // BEFORE play() — a freshly started track must begin at the correct
    // level right away instead of waiting for the ramp effect's next 16ms
    // tick (the element's `.volume` otherwise carries over whatever the
    // previous track last had it at).
    audio.volume = clampUnit((volume / 100) * (ducked ? DUCK_FRACTION : 1));
    setCurrentTrackId(id);
    setCurrentLabel(label ?? null);
    setPlaying(true);
    // AbortError means a newer play() superseded this one (rapid track
    // switch) — benign, must not flip `playing` back to false for the new
    // track. Any other rejection (e.g. NotSupportedError from a 404/bad
    // media URL) means playback genuinely never started.
    audio.play().catch((err) => {
      if ((err as { name?: string })?.name !== "AbortError") setPlaying(false);
    });
  }, [volume, ducked]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    setPlaying((wasPlaying) => {
      if (wasPlaying) {
        audio.pause();
        return false;
      }
      audio.play().catch((err) => {
        if ((err as { name?: string })?.name !== "AbortError") setPlaying(false);
      });
      return true;
    });
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPlaying(false);
    setCurrentTrackId(null);
    setCurrentLabel(null);
  }, []);

  const value: PlaybackContextValue = {
    currentTrackId,
    playing,
    playTrack,
    toggle,
    stop,
    volume,
    setVolume,
    ducked,
    setDucked
  };
  // currentLabel is tracked for future consumers (e.g. a now-playing display)
  // but not part of the required context shape yet — kept internal on purpose.
  void currentLabel;

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlaybackContext(): PlaybackContextValue {
  const value = useContext(PlaybackContext);
  if (!value) {
    throw new Error("usePlaybackContext must be used within a PlaybackProvider");
  }
  return value;
}
