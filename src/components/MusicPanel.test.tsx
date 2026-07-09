import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  musicLibraryDeleteFlowHandlers,
  musicLibraryGetErrorHandler,
  musicLibraryGetHandler,
  musicMoodErrorHandler,
  musicMoodHandler,
  musicMoodValidationHandler,
  musicTrackDeleteErrorHandler
} from "../test/handlers.js";
import { PlaybackProvider, usePlaybackContext } from "../state/PlaybackProvider.js";
import { MusicPanel } from "./MusicPanel.js";

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(PlaybackProvider, null, React.createElement(MusicPanel))
    )
  );
}

/** Test-only driver for the system-facing `ducked` flag (normally set by
 * MusicDuckingWatcher) — lets the "atenuada" badge test control it directly
 * without pulling in react-query status polling/msw wiring. */
function DuckControl() {
  const { setDucked } = usePlaybackContext();
  return (
    <div>
      <button onClick={() => setDucked(true)}>duck</button>
      <button onClick={() => setDucked(false)}>unduck</button>
    </div>
  );
}

function renderPanelWithDuckControl() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        PlaybackProvider,
        null,
        React.createElement(DuckControl),
        React.createElement(MusicPanel)
      )
    )
  );
}

/** Test-only probe that surfaces PlaybackProvider's `currentTrackId` as text,
 * so a rotation test can read exactly which track a mood click played without
 * depending on the library-derived now-playing label. */
function TrackProbe() {
  const { currentTrackId } = usePlaybackContext();
  return React.createElement("div", { "data-testid": "current-track" }, currentTrackId ?? "");
}

function renderPanelWithTrackProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        PlaybackProvider,
        null,
        React.createElement(TrackProbe),
        React.createElement(MusicPanel)
      )
    )
  );
}

describe("MusicPanel library hydrates from GET /api/music/library", () => {
  it("renders a track list item with a status badge, from the GET, per track", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));
    expect(screen.getByText("ambient_drift.mp3")).toBeInTheDocument();
    expect(screen.getAllByText("OK")).toHaveLength(2);
    expect(screen.getByText("faltante")).toBeInTheDocument();
    expect(screen.getByText("inválido")).toBeInTheDocument();
  });

  it("renders a per-mood track count from the GET", async () => {
    renderPanel();
    const counts = await screen.findByTestId("music-mood-counts");
    await waitFor(() => expect(within(counts).getByText(/calm/i)).toBeInTheDocument());
    expect(within(counts).getByText((_, element) => element?.textContent === "Calm: 1")).toBeInTheDocument();
  });

  it("shows an empty-library message when GET returns no tracks", async () => {
    server.use(musicLibraryGetHandler({ tracks: [], count: 0, moods: [] }));
    renderPanel();
    await waitFor(() => expect(screen.getByText("No hay tracks todavía.")).toBeInTheDocument());
  });

  it("surfaces a GET error/503 honestly instead of a stale/hardcoded library", async () => {
    server.use(musicLibraryGetErrorHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("list", { name: "Tracks de la biblioteca" })).not.toBeInTheDocument();
  });

  it("renders Importar as a disabled affordance requiring the desktop file dialog", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));
    const importButton = screen.getByRole("button", { name: "Importar" });
    expect(importButton).toBeDisabled();
    expect(screen.getByText(/selector de archivos de escritorio/i)).toBeInTheDocument();
  });
});

describe("MusicPanel mood grid is wired to POST /api/music/mood", () => {
  it("plays the suggested track for the clicked mood", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    const calmButton = screen.getByRole("button", { name: "Calm" });
    expect(calmButton).not.toBeDisabled();
    fireEvent.click(calmButton);

    await waitFor(() => expect(calmButton).toHaveAttribute("aria-pressed", "true"));
    const pauseButton = await screen.findByRole("button", { name: "Pausar" });
    expect(within(pauseButton.parentElement as HTMLElement).getByText("ambient_drift.mp3")).toBeInTheDocument();
  });

  it("toggles play/pause for the now-playing track", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    fireEvent.click(screen.getByRole("button", { name: "Calm" }));
    const pauseButton = await screen.findByRole("button", { name: "Pausar" });
    fireEvent.click(pauseButton);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reproducir" })).toBeInTheDocument());
  });

  it("surfaces a mood mutation error honestly (validation)", async () => {
    server.use(musicMoodValidationHandler("unknown mood"));
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: "Calm" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("surfaces a mood mutation error honestly (service unavailable)", async () => {
    server.use(musicMoodErrorHandler());
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: "Hype" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("MusicPanel mood click rotates over the bucket (random-avoid-current)", () => {
  it("plays a different track from result.tracks on repeated clicks, never immediately repeating the current one", async () => {
    server.use(
      musicMoodHandler({
        active_mood: "calm",
        tracks: [
          { id: "track-1", label: "one.mp3", mood: "calm", status: "ok" },
          { id: "track-2", label: "two.mp3", mood: "calm", status: "ok" },
          { id: "track-3", label: "three.mp3", mood: "calm", status: "ok" }
        ],
        suggested_track_id: "track-1"
      })
    );
    renderPanelWithTrackProbe();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    const calmButton = screen.getByRole("button", { name: "Calm" });
    const probe = screen.getByTestId("current-track");
    const played: string[] = [];

    // avoid-current guarantees each click lands on a DIFFERENT track than the
    // one currently playing, so waiting for the probe to change is a
    // deterministic settle point despite the random pick.
    for (let i = 0; i < 6; i += 1) {
      const previous = probe.textContent ?? "";
      fireEvent.click(calmButton);
      await waitFor(() => {
        expect(probe.textContent).not.toBe("");
        expect(probe.textContent).not.toBe(previous);
      });
      played.push(probe.textContent ?? "");
    }

    // never immediately repeats the current track
    for (let i = 1; i < played.length; i += 1) {
      expect(played[i]).not.toBe(played[i - 1]);
    }
    // rotation actually happened (not all identical)
    expect(new Set(played).size).toBeGreaterThan(1);
    // only ever plays tracks from the returned bucket
    for (const id of played) {
      expect(["track-1", "track-2", "track-3"]).toContain(id);
    }
  });

  it("rotates over the component's known valid library when the bucket is empty (hardened fallback)", async () => {
    // Hardening: even though WU1 (backend) now populates `tracks` with its own
    // normal->any fallback pool when a mood bucket is empty, the client no
    // longer trusts that invariant blindly — an empty `tracks` (e.g. a stale
    // mock, or a future backend regression) must still rotate across clicks
    // instead of always replaying the lone `suggested_track_id`. The default
    // library (renderPanelWithTrackProbe) has two "ok" tracks: track-1, track-2.
    server.use(musicMoodHandler({ active_mood: "sad", tracks: [], suggested_track_id: "track-2" }));
    renderPanelWithTrackProbe();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    const calmButton = screen.getByRole("button", { name: "Calm" });
    const probe = screen.getByTestId("current-track");
    const played: string[] = [];

    for (let i = 0; i < 6; i += 1) {
      const previous = probe.textContent ?? "";
      fireEvent.click(calmButton);
      await waitFor(() => {
        expect(probe.textContent).not.toBe("");
        expect(probe.textContent).not.toBe(previous);
      });
      played.push(probe.textContent ?? "");
    }

    for (let i = 1; i < played.length; i += 1) {
      expect(played[i]).not.toBe(played[i - 1]);
    }
    expect(new Set(played).size).toBeGreaterThan(1);
    // only ever plays "ok" tracks from the known library — never a
    // faltante/invalido track, and rotation actually happens (not stuck on
    // the lone suggested_track_id).
    for (const id of played) {
      expect(["track-1", "track-2"]).toContain(id);
    }
  });

  it("shows a subtle Spanish note when the backend reports fallback=true", async () => {
    server.use(
      musicMoodHandler({
        active_mood: "sad",
        tracks: [{ id: "track-2", label: "hype_intro.wav", mood: "hype", status: "ok" }],
        suggested_track_id: "track-2",
        fallback: true
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    fireEvent.click(screen.getByRole("button", { name: "Sad" }));
    await waitFor(() => expect(screen.getByText(/sin pistas de esta categoría/i)).toBeInTheDocument());
  });

  it("does not show the fallback note when the mood bucket has its own tracks", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    fireEvent.click(screen.getByRole("button", { name: "Calm" }));
    await screen.findByRole("button", { name: "Pausar" });
    expect(screen.queryByText(/sin pistas de esta categoría/i)).not.toBeInTheDocument();
  });
});

describe("MusicPanel Quitar is wired to DELETE /api/music/track/{id}", () => {
  it("removes the track from the list once the DELETE resolves", async () => {
    server.use(...musicLibraryDeleteFlowHandlers({
      tracks: [
        { id: "track-1", label: "ambient_drift.mp3", mood: "calm", status: "ok" },
        { id: "track-2", label: "hype_intro.wav", mood: "hype", status: "ok" }
      ],
      count: 2,
      moods: ["calm", "hype"]
    }, "track-1"));
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: 'Quitar "ambient_drift.mp3"' }));

    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(1));
    expect(screen.queryByText("ambient_drift.mp3")).not.toBeInTheDocument();
  });

  it("surfaces a DELETE failure honestly instead of silently dropping the track", async () => {
    server.use(musicTrackDeleteErrorHandler());
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    fireEvent.click(screen.getByRole("button", { name: 'Quitar "ambient_drift.mp3"' }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("ambient_drift.mp3")).toBeInTheDocument();
  });
});

describe("MusicPanel playback survives unmount when PlaybackProvider stays mounted (WU-G)", () => {
  it("keeps showing the track as playing after the panel unmounts and remounts", async () => {
    // Bug reproduction: MusicPanel used to own the <audio> element itself, so
    // unmounting it (e.g. switching Sidebar sections away from Música) killed
    // playback. Here the SAME PlaybackProvider instance is kept mounted
    // across the panel's unmount/remount via rerender — proof playback state
    // lives above the panel, not inside it.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (children: React.ReactNode) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(PlaybackProvider, null, children)
      );

    const { rerender } = render(tree(React.createElement(MusicPanel)));
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    fireEvent.click(screen.getByRole("button", { name: "Calm" }));
    await screen.findByRole("button", { name: "Pausar" });

    // Unmount the panel (simulating a Sidebar section switch) while the
    // PlaybackProvider above it stays mounted.
    rerender(tree(null));
    expect(screen.queryByRole("button", { name: "Pausar" })).not.toBeInTheDocument();

    // Remount the panel — same provider instance, so playback state (which
    // track, still playing) must still be there.
    rerender(tree(React.createElement(MusicPanel)));
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));
    expect(await screen.findByRole("button", { name: "Pausar" })).toBeInTheDocument();
  });
});

describe("MusicPanel Volumen row (FIX-D)", () => {
  it("renders a volume slider and percentage readout defaulting to 70%", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    const slider = screen.getByRole("slider", { name: /volumen/i });
    expect(slider).toHaveValue("70");
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("updates the percentage readout when the slider changes", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    fireEvent.change(screen.getByRole("slider", { name: /volumen/i }), { target: { value: "35" } });
    expect(screen.getByText("35%")).toBeInTheDocument();
  });

  it("shows an 'atenuada' badge only while ducked AND a track is playing", async () => {
    renderPanelWithDuckControl();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));

    // Ducked but nothing playing yet — no badge.
    fireEvent.click(screen.getByText("duck"));
    expect(screen.queryByText("atenuada")).not.toBeInTheDocument();

    // Start playback while ducked — badge appears.
    fireEvent.click(screen.getByRole("button", { name: "Calm" }));
    await screen.findByRole("button", { name: "Pausar" });
    expect(screen.getByText("atenuada")).toBeInTheDocument();

    // Un-duck — badge disappears even though a track is still playing.
    fireEvent.click(screen.getByText("unduck"));
    expect(screen.queryByText("atenuada")).not.toBeInTheDocument();
  });
});
