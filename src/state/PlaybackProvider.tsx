import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { trackAudioUrl } from "../api/music.js";

export interface PlaybackContextValue {
  currentTrackId: string | null;
  playing: boolean;
  playTrack(id: string, label?: string): void;
  toggle(): void;
  /** Pause the current track (no-op if nothing is playing). Unlike `toggle`,
   * this never resumes — it is the unambiguous "Pausar" verb the command
   * palette's separate transport buttons need. */
  pause(): void;
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

// Exported so tests can inject a stub context value (spied playTrack/pause/...)
// without instantiating the real shared <audio> element. Production consumers
// use usePlaybackContext / PlaybackProvider, not this directly.
export const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export const VOLUME_STORAGE_KEY = "oc-music-volume";
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

export const PLAYBACK_CHANNEL_NAME = "oc-playback-sync";

type PlaybackMessage =
  | { type: "REQUEST_STATE" }
  | {
      type: "STATE";
      payload: {
        currentTrackId: string | null;
        currentLabel: string | null;
        playing: boolean;
        volume: number;
        ducked: boolean;
      };
    }
  | { type: "CMD_PLAY"; trackId: string; label?: string }
  | { type: "CMD_PAUSE" }
  | { type: "CMD_TOGGLE" }
  | { type: "CMD_STOP" }
  | { type: "CMD_SET_VOLUME"; volume: number }
  | { type: "CMD_SET_DUCKED"; ducked: boolean };

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampVolumePercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function readStoredVolume(): number {
  try {
    const stored = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (stored === null) return DEFAULT_VOLUME;
    const parsed = Number(stored);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return DEFAULT_VOLUME;
    return parsed;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function createBroadcastChannel(): BroadcastChannel | null {
  try {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      return new window.BroadcastChannel(PLAYBACK_CHANNEL_NAME);
    }
    if (typeof globalThis !== "undefined" && "BroadcastChannel" in globalThis) {
      return new globalThis.BroadcastChannel(PLAYBACK_CHANNEL_NAME);
    }
  } catch {
    // Unsupported or security restricted
  }
  return null;
}

export type PlaybackMode = "host" | "client";

export interface PlaybackProviderProps {
  children?: ReactNode;
  /**
   * "host": Owns the real <audio> element, receives cross-window commands, broadcasts playback state.
   * "client": Does not own an <audio> element; listens to the host for state and sends commands to the host.
   * Defaults to "host".
   */
  mode?: PlaybackMode;
}

/**
 * Coordinates audio playback across all application windows.
 *
 * In host mode (default, used by AppLayout in the main Tauri window), it owns the
 * single shared <audio> element for the entire application session, executes audio
 * playback, ramps volume, and broadcasts state changes over BroadcastChannel.
 *
 * In client mode (used by auxiliary windows like DesktopCompanion), it delegates
 * audio execution to the host window to guarantee there is never more than ONE
 * physical audio stream playing simultaneously in the OS.
 */
export function PlaybackProvider({ children, mode = "host" }: PlaybackProviderProps) {
  const isHost = mode !== "client";
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (isHost && !audioRef.current) {
    audioRef.current = new Audio();
  }

  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState<number>(() => readStoredVolume());
  const [ducked, setDuckedState] = useState(false);
  const rampIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const hasHostRef = useRef(false);

  const currentTrackIdRef = useRef(currentTrackId);
  currentTrackIdRef.current = currentTrackId;

  const currentLabelRef = useRef(currentLabel);
  currentLabelRef.current = currentLabel;

  const playingRef = useRef(playing);
  playingRef.current = playing;

  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const duckedRef = useRef(ducked);
  duckedRef.current = ducked;

  const broadcastState = useCallback(
    (overrides?: Partial<{
      currentTrackId: string | null;
      currentLabel: string | null;
      playing: boolean;
      volume: number;
      ducked: boolean;
    }>) => {
      const ch = channelRef.current;
      if (!ch) return;
      try {
        ch.postMessage({
          type: "STATE",
          payload: {
            currentTrackId:
              overrides && "currentTrackId" in overrides
                ? (overrides.currentTrackId ?? null)
                : currentTrackIdRef.current,
            currentLabel:
              overrides && "currentLabel" in overrides
                ? (overrides.currentLabel ?? null)
                : currentLabelRef.current,
            playing:
              overrides && "playing" in overrides
                ? overrides.playing!
                : playingRef.current,
            volume:
              overrides && "volume" in overrides
                ? overrides.volume!
                : volumeRef.current,
            ducked:
              overrides && "ducked" in overrides
                ? overrides.ducked!
                : duckedRef.current
          }
        });
      } catch {
        // Channel closed or posting error
      }
    },
    []
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnded = () => {
      setPlaying(false);
      broadcastState({ playing: false });
    };
    const handleError = () => {
      setPlaying(false);
      broadcastState({ playing: false });
    };
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [broadcastState]);

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
        audio.volume = target;
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

  const setVolume = useCallback(
    (value: number) => {
      const clamped = clampVolumePercent(value);
      setVolumeState(clamped);
      try {
        window.localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
      } catch {}
      if (!isHost && hasHostRef.current) {
        try {
          channelRef.current?.postMessage({ type: "CMD_SET_VOLUME", volume: clamped });
        } catch {}
        return;
      }
      broadcastState({ volume: clamped });
    },
    [isHost, broadcastState]
  );

  const setDucked = useCallback(
    (value: boolean) => {
      setDuckedState(value);
      if (!isHost && hasHostRef.current) {
        try {
          channelRef.current?.postMessage({ type: "CMD_SET_DUCKED", ducked: value });
        } catch {}
        return;
      }
      broadcastState({ ducked: value });
    },
    [isHost, broadcastState]
  );

  const playTrack = useCallback(
    (id: string, label?: string) => {
      if (!isHost) {
        if (hasHostRef.current) {
          setCurrentTrackId(id);
          setCurrentLabel(label ?? null);
          setPlaying(true);
          try {
            channelRef.current?.postMessage({ type: "CMD_PLAY", trackId: id, label });
          } catch {}
          return;
        }
        // Standalone fallback if no host is running in the background
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
      }

      const audio = audioRef.current;
      if (!audio) return;
      audio.src = trackAudioUrl(id);
      audio.volume = clampUnit((volume / 100) * (ducked ? DUCK_FRACTION : 1));
      setCurrentTrackId(id);
      setCurrentLabel(label ?? null);
      setPlaying(true);
      broadcastState({ currentTrackId: id, currentLabel: label ?? null, playing: true });
      audio.play().catch((err) => {
        if ((err as { name?: string })?.name !== "AbortError") {
          setPlaying(false);
          broadcastState({ playing: false });
        }
      });
    },
    [isHost, volume, ducked, broadcastState]
  );

  const toggle = useCallback(() => {
    if (!isHost) {
      if (hasHostRef.current) {
        try {
          channelRef.current?.postMessage({ type: "CMD_TOGGLE" });
        } catch {}
        setPlaying((prev) => !prev);
        return;
      }
    }
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    setPlaying((wasPlaying) => {
      const next = !wasPlaying;
      if (wasPlaying) {
        audio.pause();
      } else {
        audio.play().catch((err) => {
          if ((err as { name?: string })?.name !== "AbortError") {
            setPlaying(false);
            broadcastState({ playing: false });
          }
        });
      }
      broadcastState({ playing: next });
      return next;
    });
  }, [isHost, broadcastState]);

  const pause = useCallback(() => {
    if (!isHost) {
      if (hasHostRef.current) {
        setPlaying(false);
        try {
          channelRef.current?.postMessage({ type: "CMD_PAUSE" });
        } catch {}
        return;
      }
    }
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPlaying(false);
    broadcastState({ playing: false });
  }, [isHost, broadcastState]);

  const stop = useCallback(() => {
    if (!isHost) {
      if (hasHostRef.current) {
        setPlaying(false);
        setCurrentTrackId(null);
        setCurrentLabel(null);
        try {
          channelRef.current?.postMessage({ type: "CMD_STOP" });
        } catch {}
        return;
      }
    }
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPlaying(false);
    setCurrentTrackId(null);
    setCurrentLabel(null);
    broadcastState({ currentTrackId: null, currentLabel: null, playing: false });
  }, [isHost, broadcastState]);

  const actionsRef = useRef({ playTrack, pause, toggle, stop, setVolume, setDucked });
  actionsRef.current = { playTrack, pause, toggle, stop, setVolume, setDucked };

  useEffect(() => {
    const ch = createBroadcastChannel();
    if (!ch) return undefined;
    channelRef.current = ch;

    const handleMessage = (event: MessageEvent<PlaybackMessage>) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (isHost) {
        switch (data.type) {
          case "REQUEST_STATE":
            ch.postMessage({
              type: "STATE",
              payload: {
                currentTrackId: currentTrackIdRef.current,
                currentLabel: currentLabelRef.current,
                playing: playingRef.current,
                volume: volumeRef.current,
                ducked: duckedRef.current
              }
            });
            break;
          case "CMD_PLAY":
            actionsRef.current.playTrack(data.trackId, data.label);
            break;
          case "CMD_PAUSE":
            actionsRef.current.pause();
            break;
          case "CMD_TOGGLE":
            actionsRef.current.toggle();
            break;
          case "CMD_STOP":
            actionsRef.current.stop();
            break;
          case "CMD_SET_VOLUME":
            actionsRef.current.setVolume(data.volume);
            break;
          case "CMD_SET_DUCKED":
            actionsRef.current.setDucked(data.ducked);
            break;
        }
      } else {
        if (data.type === "STATE") {
          hasHostRef.current = true;
          setCurrentTrackId(data.payload.currentTrackId);
          setCurrentLabel(data.payload.currentLabel);
          setPlaying(data.payload.playing);
          setVolumeState(data.payload.volume);
          setDuckedState(data.payload.ducked);
        }
      }
    };

    ch.addEventListener("message", handleMessage);

    if (isHost) {
      // Announce initial state in case clients are already listening
      ch.postMessage({
        type: "STATE",
        payload: {
          currentTrackId: currentTrackIdRef.current,
          currentLabel: currentLabelRef.current,
          playing: playingRef.current,
          volume: volumeRef.current,
          ducked: duckedRef.current
        }
      });
    } else {
      // Request current state from host
      ch.postMessage({ type: "REQUEST_STATE" });
    }

    return () => {
      ch.removeEventListener("message", handleMessage);
      ch.close();
      if (channelRef.current === ch) {
        channelRef.current = null;
      }
    };
  }, [isHost]);

  // Synchronize cross-window storage event for volume
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === VOLUME_STORAGE_KEY && e.newValue !== null) {
        const parsed = Number(e.newValue);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 100) {
          setVolumeState(parsed);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value: PlaybackContextValue = {
    currentTrackId,
    playing,
    playTrack,
    toggle,
    pause,
    stop,
    volume,
    setVolume,
    ducked,
    setDucked
  };

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
