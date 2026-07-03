import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { cn } from "../lib/cn.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import { MUSIC_FIXTURE, type MusicMood, type MusicTrackFixture, type MusicTrackStatus } from "../api/mock/fixtures.js";

// No /api/music/* endpoint exists yet — the CTK original lives in
// opencohost/ui/music_panel.py + opencohost/core/music_library.py
// (MusicLibrary, AudioBedEngine.request_mood), persisted to
// MUSIC_CONFIG_FILE json. This ships as a functional mock against
// MUSIC_FIXTURE: every mutation goes through useMockCommand (accepted !=
// applied, same contract as AgendaPanel/StreamPanel) and carries a
// role="status" disclosure. Proposed swap: GET /api/music/library, POST
// /api/music/mood, POST /api/music/fade, POST /api/music/import, DELETE
// /api/music/track/{id}.
//
// ponytail: the CTK's mood combo (import target) and mood-test grid are
// collapsed into ONE control surface here — the quick-test grid buttons
// double as the mood selector (clicking IS selecting). A separate dropdown
// picking from the same 8-mood list the grid already exhibits would just be
// two widgets doing one job; add a dropdown back if the grid ever needs to
// scroll off-screen for a longer mood list.

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

const TRACK_STATUS_BADGE: Record<MusicTrackStatus, { tone: BadgeTone; label: string }> = {
  ok: { tone: "ok", label: "OK" },
  faltante: { tone: "warn", label: "faltante" },
  invalido: { tone: "danger", label: "inválido" }
};

interface MoodCardProps {
  activeMood: MusicMood | null;
  onPlay: (mood: MusicMood) => void;
  onFade: () => void;
}

function MoodCard({ activeMood, onPlay, onFade }: MoodCardProps) {
  const moodCommand = useMockCommand<MusicMood>();
  const fadeCommand = useMockCommand<void>();
  const pending = moodCommand.pending || fadeCommand.pending;

  function play(mood: MusicMood) {
    onPlay(mood);
    void moodCommand.run(mood);
  }

  async function fade() {
    await fadeCommand.run();
    onFade();
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Mood</h2>
        {pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Reproducir un mood y hacer fade son cambios locales — no existe todavía el endpoint{" "}
          <span className="mono">/api/music/mood</span> en el backend.
        </p>

        <section aria-labelledby="music-mood-label" className="space-y-2">
          {sectionLabel("music-mood-label", "Prueba rápida")}
          <div className="grid grid-cols-4 gap-2">
            {MUSIC_FIXTURE.moods.map((mood) => (
              <Button
                key={mood}
                type="button"
                variant="ghost"
                aria-pressed={activeMood === mood}
                disabled={pending}
                onClick={() => play(mood)}
                className={cn(
                  "h-10 justify-center border-border-soft text-[13px]",
                  activeMood === mood && "bg-[image:var(--spectrum-soft)] text-[var(--kira-cyan)]"
                )}
              >
                {moodLabel(mood)}
              </Button>
            ))}
          </div>
          <p role="status" data-testid="music-active-mood" className="text-xs text-muted-foreground">
            {activeMood ? `Sonando: ${moodLabel(activeMood)}` : "Sin mood en reproducción."}
          </p>
        </section>

        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <span className="text-[13px] text-foreground">Detener el mood activo con fundido</span>
          <Button type="button" variant="outline" disabled={pending || !activeMood} onClick={() => void fade()}>
            Fade out
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface LibraryCardProps {
  tracks: MusicTrackFixture[];
  onRemove: (id: string) => void;
  onCleanupMissing: () => void;
}

function LibraryCard({ tracks, onRemove, onCleanupMissing }: LibraryCardProps) {
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

        <section aria-labelledby="music-tracks-label" className="space-y-2">
          {sectionLabel("music-tracks-label", "Tracks")}
          {tracks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay tracks todavía.</p>
          ) : (
            <ul aria-label="Tracks de la biblioteca" className="flex flex-col gap-2">
              {tracks.map((track) => {
                const badge = TRACK_STATUS_BADGE[track.status];
                return (
                  <li
                    key={track.id}
                    aria-label={`Track: ${track.name}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border-soft bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{track.name}</span>
                      <Badge tone="neutral">{moodLabel(track.mood)}</Badge>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-danger"
                      aria-label={`Quitar "${track.name}"`}
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
      </div>
    </Card>
  );
}

/**
 * Música panel — CTK parity (opencohost/ui/music_panel.py) as a functional
 * mock: mood quick-test grid (single-flight, spectrum-soft active styling) +
 * Fade out, and a track library (status badges, quitar, limpiar faltantes,
 * Importar left as a disabled not-wired affordance — see the mock-command
 * contract note at the top of this file). All state is local (useState)
 * seeded from MUSIC_FIXTURE. Deliberately self-contained: no PlayerBar
 * coupling — Kira's voice transport and background mood beds are separate
 * concerns (a future PlayerBar<->mood integration is out of scope here).
 */
export function MusicPanel() {
  const [activeMood, setActiveMood] = useState<MusicMood | null>(null);
  const [tracks, setTracks] = useState<MusicTrackFixture[]>(MUSIC_FIXTURE.tracks);

  function handleRemove(id: string) {
    setTracks((prev) => prev.filter((track) => track.id !== id));
  }

  function handleCleanupMissing() {
    setTracks((prev) => prev.filter((track) => track.status !== "faltante"));
  }

  return (
    <>
      <MoodCard activeMood={activeMood} onPlay={setActiveMood} onFade={() => setActiveMood(null)} />
      <LibraryCard tracks={tracks} onRemove={handleRemove} onCleanupMissing={handleCleanupMissing} />
    </>
  );
}
