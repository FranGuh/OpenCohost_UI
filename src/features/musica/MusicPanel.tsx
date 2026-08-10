import { useState } from "react";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import type { BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Slider } from "../../ui/Slider.js";
import { useMockCommand } from "../../api/mock/useMockCommand.js";
import {
  useDeleteMusicTrackMutation,
  useMusicLibraryQuery,
  useMusicMoodMutation,
  type MusicMoodResponse,
  type MusicTrackOut
} from "../../api/music.js";
import { MUSIC_FIXTURE } from "../../api/mock/fixtures.js";
import { usePlaybackContext } from "../../state/PlaybackProvider.js";
import { useT, type TKey } from "../../i18n/t.js";

// WU-C: MoodCard is wired to the real POST /api/music/mood
// (opencohost/api/main.py ~921) — the mood grid is enabled. LibraryCard's
// Quitar is wired to the real DELETE /api/music/track/{id}. Playback (GET
// /api/music/track/{id}/audio) is executed client-side via a single shared
// <audio> element owned by PlaybackProvider (WU-G) — the API only
// orchestrates state and never plays audio itself ("the API orchestrates,
// the client plays", resolutions 2911/2914). The <audio> element used to
// live directly inside this component, so switching Sidebar sections
// unmounted it and killed playback mid-track; it now lives in
// PlaybackProvider, mounted above the section-switched subtree (AppLayout),
// so playback survives this panel unmounting. Importar stays disabled: POST
// /api/music/import exists and is wired at the api layer (src/api/music.ts)
// with its own tests, but a browser/webview <input type=file> cannot surface
// a real filesystem path without the Tauri dialog plugin, which is not
// installed in this slice — see the role="status" note on the button.
// Limpiar faltantes has no backing endpoint yet (no bulk-cleanup route in
// main.py) and stays the pre-existing local-only mock.
//
// FIX-D: the Reproduciendo section also carries the Volumen row — a Slider
// bound to PlaybackProvider's `volume`/`setVolume` (persisted, 0-100) plus a
// mono percentage readout. The "atenuada" badge reflects PlaybackProvider's
// `ducked` flag (set by MusicDuckingWatcher from the live is_speaking poll,
// CTK parity: opencohost/core/audio_bed.py's speaking-duck), shown only
// while ducked AND a track is actually playing.

function moodLabel(mood: string): string {
  return mood.charAt(0).toUpperCase() + mood.slice(1);
}

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
 * the component's own known-valid ("ok" status) library instead of always
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

function sectionLabel(id: string, text: string) {
  return (
    <span id={id} className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
      {text}
    </span>
  );
}

const TRACK_STATUS_BADGE: Record<MusicTrackOut["status"], { tone: BadgeTone; labelKey: TKey }> = {
  ok: { tone: "ok", labelKey: "musica.library.status.ok" },
  faltante: { tone: "warn", labelKey: "musica.library.status.faltante" },
  invalido: { tone: "danger", labelKey: "musica.library.status.invalido" }
};

interface MoodCardProps {
  activeMood: string | null;
  onMoodClick: (mood: string) => void;
  pending: boolean;
  isError: boolean;
  errorMessage: string | null;
  fallbackNotice: boolean;
  nowPlayingLabel: string | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  ducked: boolean;
}

function MoodCard({
  activeMood,
  onMoodClick,
  pending,
  isError,
  errorMessage,
  fallbackNotice,
  nowPlayingLabel,
  isPlaying,
  onTogglePlay,
  volume,
  onVolumeChange,
  ducked
}: MoodCardProps) {
  const t = useT();
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("musica.mood.title")}</h2>
        {pending && <Badge tone="info">{t("musica.mood.status.applying")}</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {errorMessage ?? t("musica.mood.error")}
          </p>
        )}

        <section aria-labelledby="music-mood-label" className="space-y-2">
          {sectionLabel("music-mood-label", t("musica.mood.known.eyebrow"))}
          <div className="grid grid-cols-4 gap-2">
            {MUSIC_FIXTURE.moods.map((mood) => (
              <Button
                key={mood}
                type="button"
                variant={activeMood === mood ? "primary" : "ghost"}
                aria-pressed={activeMood === mood}
                disabled={pending}
                onClick={() => onMoodClick(mood)}
                className="h-10 justify-center border-border-soft text-[13px]"
              >
                {moodLabel(mood)}
              </Button>
            ))}
          </div>
          {fallbackNotice && (
            <p role="status" className="text-xs leading-relaxed text-dim">
              {t("musica.mood.fallback.notice")}
            </p>
          )}
        </section>

        <section aria-labelledby="music-now-playing-label" className="space-y-2">
          {sectionLabel("music-now-playing-label", t("musica.mood.nowPlaying.eyebrow"))}
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <Slider value={volume} onChange={onVolumeChange} aria-label={t("musica.mood.volume.aria")} />
            <div className="flex items-center gap-2">
              <span className="mono text-[13px] text-dim">{volume}%</span>
              {ducked && isPlaying && <Badge tone="info">{t("musica.mood.volume.ducked")}</Badge>}
            </div>
          </div>
          {nowPlayingLabel ? (
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="truncate text-[13px] text-foreground">{nowPlayingLabel}</span>
              <Button type="button" variant="outline" onClick={onTogglePlay}>
                {isPlaying ? t("musica.mood.pause.action") : t("musica.mood.play.action")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("musica.mood.nowPlaying.empty")}</p>
          )}
        </section>
      </div>
    </Card>
  );
}

interface LibraryCardProps {
  tracks: MusicTrackOut[];
  isLoading: boolean;
  isError: boolean;
  onRemove: (id: string) => void;
  deletePending: boolean;
  deleteError: string | null;
  onCleanupMissing: () => void;
  cleanupPending: boolean;
  playingTrackId: string | null;
  isPlaying: boolean;
  onPlayTrack: (id: string) => void;
  onTogglePlay: () => void;
}

function LibraryCard({
  tracks,
  isLoading,
  isError,
  onRemove,
  deletePending,
  deleteError,
  onCleanupMissing,
  cleanupPending,
  playingTrackId,
  isPlaying,
  onPlayTrack,
  onTogglePlay
}: LibraryCardProps) {
  const t = useT();
  const hasMissing = tracks.some((track) => track.status === "faltante");

  const moodCounts = Array.from(new Set(tracks.map((track) => track.mood))).map((mood) => ({
    mood,
    count: tracks.filter((track) => track.mood === mood).length
  }));

  function handlePlayClick(track: MusicTrackOut) {
    if (track.id === playingTrackId) {
      onTogglePlay();
    } else {
      onPlayTrack(track.id);
    }
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("musica.library.title")}</h2>
        <div className="flex items-center gap-2">
          <Badge tone="info">{t("musica.library.trackCount", { n: tracks.length })}</Badge>
          {(deletePending || cleanupPending) && <Badge tone="info">{t("musica.library.status.applying")}</Badge>}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {isError ? (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t("musica.library.error")}
          </p>
        ) : (
          <>
            {deleteError && (
              <p role="alert" className="text-xs leading-relaxed text-danger">
                {deleteError}
              </p>
            )}

            <section aria-labelledby="music-import-label" className="space-y-2">
              {sectionLabel("music-import-label", t("musica.library.import.eyebrow"))}
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <span className="text-[13px] text-muted-foreground">{t("musica.library.import.hint")}</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled
                  title={t("musica.library.import.disabled.title")}
                >
                  {t("musica.library.import.action")}
                </Button>
              </div>
              <p role="status" className="text-xs leading-relaxed text-dim">
                <span className="mono">POST /api/music/import</span> {t("musica.library.import.notice")}
              </p>
            </section>

            {!isLoading && tracks.length > 0 && (
              <section aria-labelledby="music-mood-counts-label" className="space-y-2">
                {sectionLabel("music-mood-counts-label", t("musica.library.moodCounts.eyebrow"))}
                <div data-testid="music-mood-counts" className="flex flex-wrap gap-2">
                  {moodCounts.map(({ mood, count }) => (
                    <Badge key={mood} tone="neutral">
                      {moodLabel(mood)}: {count}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="music-tracks-label" className="space-y-2">
              {sectionLabel("music-tracks-label", t("musica.library.tracks.eyebrow"))}
              {isLoading ? (
                <p className="text-sm text-muted-foreground">{t("musica.library.loading")}</p>
              ) : tracks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("musica.library.empty")}</p>
              ) : (
                <ul aria-label={t("musica.library.list.aria")} className="flex flex-col gap-2">
                  {tracks.map((track) => {
                    const badge = TRACK_STATUS_BADGE[track.status];
                    const isCurrent = track.id === playingTrackId;
                    return (
                      <li
                        key={track.id}
                        aria-label={t("musica.library.track.aria", { name: track.label })}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md border border-border-soft bg-background p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2 md:justify-between">
                          <span className="text-[13px] font-semibold text-foreground">{track.label}</span>
                            <Badge tone="neutral" className="ml-auto">{moodLabel(track.mood)}</Badge>
                            <Badge tone={badge.tone}>{t(badge.labelKey)}</Badge>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          aria-label={
                            isCurrent && isPlaying
                              ? t("musica.library.track.pause.aria", { name: track.label })
                              : t("musica.library.track.play.aria", { name: track.label })
                          }
                          disabled={track.status !== "ok"}
                          onClick={() => handlePlayClick(track)}
                        >
                          {isCurrent && isPlaying ? "⏸" : "▶"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-danger"
                          aria-label={t("musica.library.track.remove.aria", { name: track.label })}
                          disabled={deletePending}
                          onClick={() => onRemove(track.id)}
                        >
                          ✕
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">{t("musica.library.cleanup.hint")}</span>
              <Button
                type="button"
                variant="outline"
                disabled={cleanupPending || !hasMissing}
                onClick={onCleanupMissing}
              >
                {t("musica.library.cleanup.action")}
              </Button>
            </div>
            <p role="status" className="text-xs leading-relaxed text-dim">
              {t("musica.library.cleanup.notice")}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Música panel — CTK parity (opencohost/ui/music_panel.py). Biblioteca
 * hydrates from the live GET /api/music/library. MoodCard's quick-test grid
 * is wired to the real POST /api/music/mood and plays the suggested track
 * client-side; LibraryCard's Quitar is wired to the real DELETE
 * /api/music/track/{id}. See the module note above for exactly what's wired
 * vs. deferred (Importar, Limpiar faltantes).
 */
export function MusicPanel() {
  const t = useT();
  const { data, isLoading, isError } = useMusicLibraryQuery();
  const moodMutation = useMusicMoodMutation();
  const deleteMutation = useDeleteMusicTrackMutation();
  const cleanupCommand = useMockCommand<void>();
  const playback = usePlaybackContext();

  const tracks = data?.tracks ?? [];
  const [activeMood, setActiveMood] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState(false);

  const playingTrackId = playback.currentTrackId;
  const isPlaying = playback.playing;

  function playTrack(trackId: string) {
    const track = tracks.find((candidate) => candidate.id === trackId);
    playback.playTrack(trackId, track?.label);
  }

  function togglePlay() {
    playback.toggle();
  }

  function handleMoodClick(mood: string) {
    moodMutation.mutate(mood, {
      onSuccess: (result: MusicMoodResponse) => {
        setActiveMood(result.active_mood);
        setFallbackNotice(Boolean(result.fallback));
        const trackId = pickRotationTrack(result, playingTrackId, tracks);
        if (trackId) {
          playTrack(trackId);
        }
      }
    });
  }

  function handleRemove(id: string) {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        if (playingTrackId === id) {
          playback.stop();
        }
      }
    });
  }

  function handleCleanupMissing() {
    void cleanupCommand.run();
  }

  const nowPlaying = tracks.find((track) => track.id === playingTrackId) ?? null;

  return (
    <>
      <MoodCard
        activeMood={activeMood}
        onMoodClick={handleMoodClick}
        pending={moodMutation.isPending}
        isError={moodMutation.isError}
        errorMessage={moodMutation.error?.message ?? null}
        fallbackNotice={fallbackNotice}
        nowPlayingLabel={nowPlaying?.label ?? null}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        volume={playback.volume}
        onVolumeChange={playback.setVolume}
        ducked={playback.ducked}
      />
      <LibraryCard
        tracks={tracks}
        isLoading={isLoading}
        isError={isError}
        onRemove={handleRemove}
        deletePending={deleteMutation.isPending}
        deleteError={deleteMutation.isError ? (deleteMutation.error?.message ?? t("musica.library.remove.error")) : null}
        onCleanupMissing={handleCleanupMissing}
        cleanupPending={cleanupCommand.pending}
        playingTrackId={playingTrackId}
        isPlaying={isPlaying}
        onPlayTrack={playTrack}
        onTogglePlay={togglePlay}
      />
    </>
  );
}
