import { useEffect, useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import { useMusicLibraryQuery, type MusicTrackOut } from "../api/music.js";
import { MUSIC_FIXTURE } from "../api/mock/fixtures.js";

// S11: LibraryCard is wired to the live GET /api/music/library
// (opencohost/api/main.py ~459, opencohost/core/music_library.py
// MusicLibrary.all_tracks) — read-only, no queue, no audio. Two affordances
// stay deliberately disabled with a role="status" blocker note because their
// backing verbs don't exist yet: Importar (no upload endpoint — a local-file
// vs multipart-upload UX decision is still the owner's to make) and the mood
// quick-test grid (server-side playback via AudioBedEngine.request_mood is
// deferred by design — this is a pure library listing, not a player). Quitar
// track / Limpiar faltantes remain the same local-only mock they were before
// this slice (no DELETE /api/music/track/{id} either) — out of scope here.

function moodLabel(mood: string): string {
  return mood.charAt(0).toUpperCase() + mood.slice(1);
}

function sectionLabel(id: string, text: string) {
  return (
    <span id={id} className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
      {text}
    </span>
  );
}

const TRACK_STATUS_BADGE: Record<MusicTrackOut["status"], { tone: BadgeTone; label: string }> = {
  ok: { tone: "ok", label: "OK" },
  faltante: { tone: "warn", label: "faltante" },
  invalido: { tone: "danger", label: "inválido" }
};

function MoodCard() {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Mood</h2>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Reproducción server-side no implementada — no existe todavía{" "}
          <span className="mono">POST /api/music/mood</span> en el backend. Los botones son solo referencia de moods
          conocidos.
        </p>

        <section aria-labelledby="music-mood-label" className="space-y-2">
          {sectionLabel("music-mood-label", "Moods conocidos")}
          <div className="grid grid-cols-4 gap-2">
            {MUSIC_FIXTURE.moods.map((mood) => (
              <Button
                key={mood}
                type="button"
                variant="ghost"
                aria-pressed={false}
                disabled
                className="h-10 justify-center border-border-soft text-[13px]"
              >
                {moodLabel(mood)}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </Card>
  );
}

interface LibraryCardProps {
  tracks: MusicTrackOut[];
  moods: string[];
  isLoading: boolean;
  isError: boolean;
  onRemove: (id: string) => void;
  onCleanupMissing: () => void;
}

function LibraryCard({ tracks, moods, isLoading, isError, onRemove, onCleanupMissing }: LibraryCardProps) {
  const deleteCommand = useMockCommand<string>();
  const cleanupCommand = useMockCommand<void>();
  const pending = deleteCommand.pending || cleanupCommand.pending;
  const hasMissing = tracks.some((track) => track.status === "faltante");

  function remove(id: string) {
    onRemove(id);
    void deleteCommand.run(id);
  }

  function cleanupMissing() {
    onCleanupMissing();
    void cleanupCommand.run();
  }

  const moodCounts = moods.map((mood) => ({
    mood,
    count: tracks.filter((track) => track.mood === mood).length
  }));

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Biblioteca</h2>
        <div className="flex items-center gap-2">
          <Badge tone="info">{tracks.length} tracks</Badge>
          {pending && <Badge tone="info">aplicando…</Badge>}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {isError ? (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            No se pudo cargar la biblioteca de música en vivo.
          </p>
        ) : (
          <>
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">
              Quitar tracks y limpiar faltantes son cambios locales — no existe todavía{" "}
              <span className="mono">DELETE /api/music/track/{"{id}"}</span> en el backend.
            </p>

            <section aria-labelledby="music-import-label" className="space-y-2">
              {sectionLabel("music-import-label", "Importar track")}
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <span className="text-[13px] text-muted-foreground">Subir .mp3 o .wav</span>
                <Button type="button" variant="outline" disabled title="Decisión de UX pendiente (archivo local vs subida)">
                  Importar
                </Button>
              </div>
              <p role="status" className="text-xs leading-relaxed text-dim">
                Importar es una decisión pendiente del owner (elegir archivo local vs subida multipart) — todavía no
                existe <span className="mono">POST /api/music/import</span>, así que no se simula una carga.
              </p>
            </section>

            {!isLoading && tracks.length > 0 && (
              <section aria-labelledby="music-mood-counts-label" className="space-y-2">
                {sectionLabel("music-mood-counts-label", "Tracks por mood")}
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
              {sectionLabel("music-tracks-label", "Tracks")}
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando biblioteca…</p>
              ) : tracks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay tracks todavía.</p>
              ) : (
                <ul aria-label="Tracks de la biblioteca" className="flex flex-col gap-2">
                  {tracks.map((track) => {
                    const badge = TRACK_STATUS_BADGE[track.status];
                    return (
                      <li
                        key={track.id}
                        aria-label={`Track: ${track.label}`}
                        className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border-soft bg-background p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-foreground">{track.label}</span>
                          <Badge tone="neutral">{moodLabel(track.mood)}</Badge>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-danger"
                          aria-label={`Quitar "${track.label}"`}
                          disabled={pending}
                          onClick={() => remove(track.id)}
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
              <span className="text-[13px] text-foreground">Quitar todos los tracks faltantes</span>
              <Button type="button" variant="outline" disabled={pending || !hasMissing} onClick={cleanupMissing}>
                Limpiar faltantes
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Música panel — CTK parity (opencohost/ui/music_panel.py), read-only slice
 * (S11): LibraryCard hydrates from the live GET /api/music/library (track
 * list with status badges + per-mood counts, quitar/limpiar faltantes still
 * a local-only mock). MoodCard's quick-test grid is a disabled reference
 * list — see the module note above for exactly what's wired vs. deferred.
 * Deliberately self-contained: no PlayerBar coupling — Kira's voice
 * transport and background mood beds are separate concerns.
 */
export function MusicPanel() {
  const { data, isLoading, isError } = useMusicLibraryQuery();
  const [tracks, setTracks] = useState<MusicTrackOut[]>([]);

  useEffect(() => {
    if (data) {
      setTracks(data.tracks);
    }
  }, [data]);

  function handleRemove(id: string) {
    setTracks((prev) => prev.filter((track) => track.id !== id));
  }

  function handleCleanupMissing() {
    setTracks((prev) => prev.filter((track) => track.status !== "faltante"));
  }

  return (
    <>
      <MoodCard />
      <LibraryCard
        tracks={tracks}
        moods={data?.moods ?? []}
        isLoading={isLoading}
        isError={isError}
        onRemove={handleRemove}
        onCleanupMissing={handleCleanupMissing}
      />
    </>
  );
}
