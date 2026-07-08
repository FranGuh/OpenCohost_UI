import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackProvider, usePlaybackContext } from "./PlaybackProvider.js";

const VOLUME_STORAGE_KEY = "oc-music-volume";

/** Minimal consumer exposing every context value/action as clickable
 * buttons + readable spans, so tests can drive and assert on the context
 * without depending on any real panel UI. */
function Harness() {
  const playback = usePlaybackContext();
  return (
    <div>
      <button onClick={() => playback.playTrack("track-1", "Track One")}>play track-1</button>
      <button onClick={() => playback.playTrack("track-2", "Track Two")}>play track-2</button>
      <button onClick={playback.toggle}>toggle</button>
      <button onClick={playback.stop}>stop</button>
      <button onClick={() => playback.setVolume(50)}>set volume 50</button>
      <button onClick={() => playback.setVolume(35)}>set volume 35</button>
      <button onClick={() => playback.setDucked(true)}>duck</button>
      <button onClick={() => playback.setDucked(false)}>unduck</button>
      <span data-testid="playing">{String(playback.playing)}</span>
      <span data-testid="current">{playback.currentTrackId ?? ""}</span>
      <span data-testid="volume">{playback.volume}</span>
      <span data-testid="ducked">{String(playback.ducked)}</span>
    </div>
  );
}

function renderHarness() {
  return render(
    React.createElement(PlaybackProvider, null, React.createElement(Harness))
  );
}

describe("PlaybackProvider", () => {
  it("throws when usePlaybackContext is used outside a PlaybackProvider", () => {
    // Swallow the expected React error-boundary console noise for this one assertion.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(React.createElement(Harness))).toThrow(
      /usePlaybackContext must be used within a PlaybackProvider/
    );
    spy.mockRestore();
  });

  it("starts a track and marks it as the current/playing track", () => {
    renderHarness();
    fireEvent.click(screen.getByText("play track-1"));
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
    expect(screen.getByTestId("current")).toHaveTextContent("track-1");
  });

  it("toggle() pauses the currently playing track", () => {
    renderHarness();
    fireEvent.click(screen.getByText("play track-1"));
    expect(screen.getByTestId("playing")).toHaveTextContent("true");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("playing")).toHaveTextContent("true");
  });

  it("stop() clears the current track and playing state", () => {
    renderHarness();
    fireEvent.click(screen.getByText("play track-1"));
    fireEvent.click(screen.getByText("stop"));
    expect(screen.getByTestId("playing")).toHaveTextContent("false");
    expect(screen.getByTestId("current")).toHaveTextContent("");
  });

  describe("audio element src swap", () => {
    const originalAudio = window.Audio;
    const instances: HTMLAudioElement[] = [];

    afterEach(() => {
      window.Audio = originalAudio;
      instances.length = 0;
    });

    it("swaps the shared audio element's src when switching tracks", () => {
      // Capture the ONE audio element the provider creates so we can inspect
      // `.src` directly — proof there's a single shared element being
      // re-targeted, not a new element per track.
      class SpyAudio extends originalAudio {
        constructor(...args: ConstructorParameters<typeof Audio>) {
          super(...args);
          instances.push(this);
        }
      }
      window.Audio = SpyAudio as unknown as typeof Audio;

      renderHarness();
      fireEvent.click(screen.getByText("play track-1"));
      expect(instances).toHaveLength(1);
      expect(instances[0].src).toContain("track-1");

      fireEvent.click(screen.getByText("play track-2"));
      expect(instances).toHaveLength(1); // same element, re-targeted — not a second one
      expect(instances[0].src).toContain("track-2");
      expect(instances[0].src).not.toContain("track-1");
    });
  });

  describe("play() rejection reconciliation", () => {
    // jsdom resets an extended Audio/HTMLAudioElement subclass's internal
    // implementation after construction, so overriding play() via a
    // subclass (as the "audio element src swap" describe above does for
    // the constructor only) is unreliable for method overrides. Stub
    // HTMLMediaElement.prototype.play directly instead — the same approach
    // src/test/setup.ts uses for the global default.
    const originalPlay = window.HTMLMediaElement.prototype.play;

    afterEach(() => {
      window.HTMLMediaElement.prototype.play = originalPlay;
    });

    function stubPlayRejection(errorName: string) {
      window.HTMLMediaElement.prototype.play = () => {
        const err = new Error(errorName);
        err.name = errorName;
        return Promise.reject(err);
      };
    }

    it("flips playing to false when play() rejects with a real playback error (e.g. NotSupportedError)", async () => {
      stubPlayRejection("NotSupportedError");
      renderHarness();

      fireEvent.click(screen.getByText("play track-1"));
      expect(screen.getByTestId("playing")).toHaveTextContent("true");

      await waitFor(() => expect(screen.getByTestId("playing")).toHaveTextContent("false"));
    });

    it("keeps playing true when play() rejects with AbortError (superseded by a rapid track switch)", async () => {
      stubPlayRejection("AbortError");
      renderHarness();

      fireEvent.click(screen.getByText("play track-1"));
      expect(screen.getByTestId("playing")).toHaveTextContent("true");

      // Let the rejected promise's microtask settle — playing must stay true.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.getByTestId("playing")).toHaveTextContent("true");
    });

    it("flips playing to false when the audio element fires an error event after play() resolved", async () => {
      const originalAudio = window.Audio;
      const instances: HTMLAudioElement[] = [];
      class SpyAudio extends originalAudio {
        constructor(...args: ConstructorParameters<typeof Audio>) {
          super(...args);
          instances.push(this);
        }
      }
      window.Audio = SpyAudio as unknown as typeof Audio;

      try {
        renderHarness();
        fireEvent.click(screen.getByText("play track-1"));
        expect(screen.getByTestId("playing")).toHaveTextContent("true");

        fireEvent.error(instances[0]);
        expect(screen.getByTestId("playing")).toHaveTextContent("false");
      } finally {
        window.Audio = originalAudio;
      }
    });
  });

  describe("volume + ducking (FIX-D)", () => {
    const originalAudio = window.Audio;
    const instances: HTMLAudioElement[] = [];

    class SpyAudio extends originalAudio {
      constructor(...args: ConstructorParameters<typeof Audio>) {
        super(...args);
        instances.push(this);
      }
    }

    beforeEach(() => {
      window.localStorage.removeItem(VOLUME_STORAGE_KEY);
      window.Audio = SpyAudio as unknown as typeof Audio;
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      window.Audio = originalAudio;
      instances.length = 0;
      window.localStorage.removeItem(VOLUME_STORAGE_KEY);
    });

    it("defaults to 70% volume, unducked", () => {
      renderHarness();
      expect(screen.getByTestId("volume")).toHaveTextContent("70");
      expect(screen.getByTestId("ducked")).toHaveTextContent("false");
    });

    it("setVolume(50) ramps the shared element's volume to 0.5 over ~300ms", () => {
      renderHarness();
      fireEvent.click(screen.getByText("set volume 50"));
      expect(screen.getByTestId("volume")).toHaveTextContent("50");

      vi.advanceTimersByTime(320);
      expect(instances[0].volume).toBeCloseTo(0.5);
    });

    it("setDucked(true) ramps down to volume * 0.3, setDucked(false) restores it", () => {
      renderHarness();
      fireEvent.click(screen.getByText("set volume 50"));
      vi.advanceTimersByTime(320);
      expect(instances[0].volume).toBeCloseTo(0.5);

      fireEvent.click(screen.getByText("duck"));
      expect(screen.getByTestId("ducked")).toHaveTextContent("true");
      vi.advanceTimersByTime(320);
      expect(instances[0].volume).toBeCloseTo(0.15);

      fireEvent.click(screen.getByText("unduck"));
      vi.advanceTimersByTime(320);
      expect(instances[0].volume).toBeCloseTo(0.5);
    });

    it("cancels an in-flight ramp when the target changes mid-ramp", () => {
      renderHarness();
      fireEvent.click(screen.getByText("set volume 50"));
      vi.advanceTimersByTime(320);
      expect(instances[0].volume).toBeCloseTo(0.5);

      fireEvent.click(screen.getByText("duck"));
      vi.advanceTimersByTime(150); // interrupt mid-ramp, before it reaches 0.15
      fireEvent.click(screen.getByText("unduck")); // target changes before the duck ramp finished

      vi.advanceTimersByTime(320);
      // Must converge on the NEW target (0.5), not the abandoned duck target
      // (0.15) or some frozen blend of the two.
      expect(instances[0].volume).toBeCloseTo(0.5);
    });

    it("applies the correct (possibly ducked) volume level BEFORE play(), without waiting for a ramp tick", () => {
      renderHarness();
      fireEvent.click(screen.getByText("set volume 50"));
      vi.advanceTimersByTime(320);
      expect(instances[0].volume).toBeCloseTo(0.5);

      // Duck, then immediately start a track with ZERO elapsed timer time —
      // the ramp interval has been scheduled but has not ticked once yet.
      fireEvent.click(screen.getByText("duck"));
      fireEvent.click(screen.getByText("play track-1"));

      expect(instances[0].volume).toBeCloseTo(0.15);
    });

    it("persists volume to localStorage under the 'oc-music-volume' key", () => {
      renderHarness();
      fireEvent.click(screen.getByText("set volume 35"));
      expect(window.localStorage.getItem(VOLUME_STORAGE_KEY)).toBe("35");
    });

    it("re-initializes from a persisted localStorage value on the next mount", () => {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, "42");
      renderHarness();
      expect(screen.getByTestId("volume")).toHaveTextContent("42");
    });

    it("falls back to the default (70) when the persisted value is not a valid integer 0-100", () => {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, "not-a-number");
      renderHarness();
      expect(screen.getByTestId("volume")).toHaveTextContent("70");
    });
  });
});
