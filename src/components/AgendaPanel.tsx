import { useState } from "react";
import type { FormEvent } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { Select } from "./ui/Select.js";
import { Segmented } from "./ui/Segmented.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import {
  AGENDA_FIXTURE,
  type AgendaConfidence,
  type AgendaPriority,
  type AgendaQueueTopic,
  type AgendaRhythm,
  type AgendaSafetyMode,
  type AgendaSessionState,
  type AgendaSuggestion
} from "../api/mock/fixtures.js";

// No /api/agenda* endpoint exists yet — the CTK original lives in
// opencohost/smart_aggregator/kira_agenda_controller.py +
// opencohost/ui/cohost_agenda_panel.py, persisted to EDITORIAL_CARDS_DB
// sqlite. This ships as a functional mock against AGENDA_FIXTURE, shaped so
// swapping each useState for a TanStack Query hook (GET /api/agenda) and
// each useMockCommand for a real useMutation (POST /api/agenda/{topic|
// suggestion|session}) is a rename, not a reshape. Local state updates
// immediately on every action (accepted != applied, same contract as
// useProfileSwitch/useMockCommand elsewhere) — the mock command only drives
// the pending/disable/Badge affordance, and every section that mutates
// local-only data carries a persistent role="status" note so nothing reads
// as a real persisted result.

const RHYTHM_OPTIONS = [
  { value: "calmo", label: "Calmo" },
  { value: "normal", label: "Normal" },
  { value: "dinamico", label: "Dinámico" }
] as const satisfies ReadonlyArray<{ value: AgendaRhythm; label: string }>;

const SAFETY_MODE_OPTIONS: ReadonlyArray<{ value: AgendaSafetyMode; label: string }> = [
  { value: "live_safe", label: "Live-safe" },
  { value: "monologue", label: "Monólogo" },
  { value: "test", label: "Test" }
];

const TURN_OPTIONS = ["1", "2", "3", "5", "8"] as const;

const PRIORITY_BADGE: Record<AgendaPriority, { tone: BadgeTone; label: string }> = {
  alta: { tone: "warn", label: "Alta" },
  normal: { tone: "info", label: "Normal" },
  baja: { tone: "ok", label: "Baja" }
};

const CONFIDENCE_BADGE: Record<AgendaConfidence, { tone: BadgeTone; label: string }> = {
  HIGH: { tone: "ok", label: "confianza alta" },
  MEDIUM: { tone: "info", label: "confianza media" },
  LOW: { tone: "warn", label: "confianza baja" }
};

const SESSION_BADGE: Record<AgendaSessionState, { tone: BadgeTone; label: string }> = {
  off: { tone: "info", label: "inactiva" },
  active: { tone: "ok", label: "activa" },
  paused: { tone: "warn", label: "pausa suave" }
};

function moveQueueItem(queue: AgendaQueueTopic[], id: string, direction: -1 | 1): AgendaQueueTopic[] {
  const idx = queue.findIndex((topic) => topic.id === id);
  const target = idx + direction;
  if (idx === -1 || target < 0 || target >= queue.length) return queue;
  const next = [...queue];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

function sectionLabel(id: string, text: string) {
  return (
    <span id={id} className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
      {text}
    </span>
  );
}

interface ProfileSessionCardProps {
  name: string;
  onSaveName: (name: string) => void;
  turns: string;
  onTurnsChange: (turns: string) => void;
  rhythm: AgendaRhythm;
  onRhythmChange: (rhythm: AgendaRhythm) => void;
  safetyMode: AgendaSafetyMode;
  onSafetyModeChange: (mode: AgendaSafetyMode) => void;
}

function ProfileSessionCard({
  name,
  onSaveName,
  turns,
  onTurnsChange,
  rhythm,
  onRhythmChange,
  safetyMode,
  onSafetyModeChange
}: ProfileSessionCardProps) {
  const [draftName, setDraftName] = useState(name);
  const nameCommand = useMockCommand<string>();
  const turnsCommand = useMockCommand<string>();
  const rhythmCommand = useMockCommand<AgendaRhythm>();
  const safetyCommand = useMockCommand<AgendaSafetyMode>();
  const pending = nameCommand.pending || turnsCommand.pending || rhythmCommand.pending || safetyCommand.pending;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Perfil Co-host</h2>
        {pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Perfil y configuración de sesión son vistas previas locales — no existe endpoint{" "}
          <span className="mono">/api/agenda</span> en el backend.
        </p>

        <section aria-labelledby="agenda-profile-label" className="space-y-2">
          {sectionLabel("agenda-profile-label", "Nombre del perfil")}
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <input
              type="text"
              aria-label="Nombre del perfil co-host"
              value={draftName}
              disabled={nameCommand.pending}
              onChange={(event) => setDraftName(event.target.value)}
              className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
            <Button
              type="button"
              variant="outline"
              disabled={nameCommand.pending || !draftName.trim()}
              onClick={() => {
                const trimmed = draftName.trim();
                onSaveName(trimmed);
                void nameCommand.run(trimmed);
              }}
            >
              Guardar perfil
            </Button>
          </div>
        </section>

        <section aria-labelledby="agenda-session-settings-label" className="space-y-2">
          {sectionLabel("agenda-session-settings-label", "Configuración de sesión")}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Turnos por tema</span>
              <Select
                aria-label="Turnos por tema"
                value={turns}
                disabled={turnsCommand.pending}
                onChange={(event) => {
                  onTurnsChange(event.target.value);
                  void turnsCommand.run(event.target.value);
                }}
              >
                {TURN_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Modo de seguridad en vivo</span>
              <Select
                aria-label="Modo de seguridad en vivo"
                value={safetyMode}
                disabled={safetyCommand.pending}
                onChange={(event) => {
                  const value = event.target.value as AgendaSafetyMode;
                  onSafetyModeChange(value);
                  void safetyCommand.run(value);
                }}
              >
                {SAFETY_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">Ritmo</span>
          <Segmented
            ariaLabel="Ritmo"
            options={RHYTHM_OPTIONS}
            value={rhythm}
            disabled={rhythmCommand.pending}
            onChange={(value) => {
              onRhythmChange(value);
              void rhythmCommand.run(value);
            }}
          />
        </section>
      </div>
    </Card>
  );
}

function NowCard({ now }: { now: AgendaQueueTopic | null }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Ahora</h2>
      </div>
      <div data-testid="agenda-now" className="pt-3.5">
        {now ? (
          <div className="flex flex-col gap-2 rounded-md bg-[image:var(--spectrum-soft)] p-3">
            <Badge tone="ok" className="w-fit">
              en vivo
            </Badge>
            <p className="text-sm font-semibold text-[var(--kira-cyan)]">{now.title}</p>
            {now.angle && <p className="text-xs leading-relaxed text-muted-foreground">{now.angle}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sin tema activo en este momento.</p>
        )}
      </div>
    </Card>
  );
}

interface QueueCardProps {
  queue: AgendaQueueTopic[];
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}

function QueueCard({ queue, onMove, onRemove }: QueueCardProps) {
  const command = useMockCommand<{ id: string; action: string }>();

  function move(id: string, direction: -1 | 1) {
    onMove(id, direction);
    void command.run({ id, action: direction === -1 ? "subir" : "bajar" });
  }

  function remove(id: string) {
    onRemove(id);
    void command.run({ id, action: "quitar" });
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Cola de temas</h2>
        <div className="flex items-center gap-2">
          <Badge tone="info">{queue.length} en cola</Badge>
          {command.pending && <Badge tone="info">aplicando…</Badge>}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Reordenar y quitar temas son cambios locales — no existe todavía el endpoint{" "}
          <span className="mono">/api/agenda/queue</span>.
        </p>

        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay temas en cola todavía.</p>
        ) : (
          <ol aria-label="Cola de temas ordenada" className="flex flex-col gap-2">
            {queue.map((topic, index) => {
              const badge = PRIORITY_BADGE[topic.priority];
              return (
                <li
                  key={topic.id}
                  aria-label={`Tema en cola: ${topic.title}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border-soft bg-background p-3"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{topic.title}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                    {topic.angle && <span className="text-xs text-muted-foreground">{topic.angle}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      aria-label={`Subir "${topic.title}"`}
                      disabled={command.pending || index === 0}
                      onClick={() => move(topic.id, -1)}
                    >
                      ▲
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      aria-label={`Bajar "${topic.title}"`}
                      disabled={command.pending || index === queue.length - 1}
                      onClick={() => move(topic.id, 1)}
                    >
                      ▼
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-danger"
                      aria-label={`Quitar "${topic.title}"`}
                      disabled={command.pending}
                      onClick={() => remove(topic.id)}
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

interface SuggestionsCardProps {
  suggestions: AgendaSuggestion[];
  onApprove: (suggestion: AgendaSuggestion) => void;
  onReject: (id: string) => void;
}

function SuggestionsCard({ suggestions, onApprove, onReject }: SuggestionsCardProps) {
  const command = useMockCommand<{ id: string; action: string }>();

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Sugerencias de Kira</h2>
        {command.pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Aprobar o rechazar mueve la sugerencia solo en esta sesión — no existe POST{" "}
          <span className="mono">/api/agenda/suggestion</span> todavía.
        </p>

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin sugerencias pendientes.</p>
        ) : (
          <ul aria-label="Sugerencias de Kira" className="flex flex-col gap-2">
            {suggestions.map((suggestion) => {
              const badge = CONFIDENCE_BADGE[suggestion.confidence];
              return (
                <li
                  key={suggestion.id}
                  aria-label={suggestion.title}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border-soft bg-background p-3"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{suggestion.title}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{suggestion.angle || "Sin ángulo"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={command.pending}
                      aria-label={`Aprobar "${suggestion.title}"`}
                      onClick={() => {
                        onApprove(suggestion);
                        void command.run({ id: suggestion.id, action: "aprobar" });
                      }}
                    >
                      Aprobar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={command.pending}
                      aria-label={`Rechazar "${suggestion.title}"`}
                      onClick={() => {
                        onReject(suggestion.id);
                        void command.run({ id: suggestion.id, action: "rechazar" });
                      }}
                    >
                      Rechazar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

function AddTopicCard({ onAdd }: { onAdd: (title: string, angle: string) => void }) {
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const command = useMockCommand<{ title: string; angle: string }>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("El título no puede estar vacío.");
      return;
    }
    setError(null);
    onAdd(trimmedTitle, angle.trim());
    void command.run({ title: trimmedTitle, angle: angle.trim() });
    setTitle("");
    setAngle("");
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Agregar tema</h2>
        {command.pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Agregar temas es un cambio local — no existe todavía POST{" "}
          <span className="mono">/api/agenda/topic</span> en el backend.
        </p>

        <section aria-labelledby="agenda-add-topic-label" className="space-y-2">
          {sectionLabel("agenda-add-topic-label", "Tema aprobado")}
          <input
            type="text"
            aria-label="Título del tema"
            value={title}
            disabled={command.pending}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tema claro, máximo 90 caracteres"
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
          <input
            type="text"
            aria-label="Ángulo (opcional)"
            value={angle}
            disabled={command.pending}
            onChange={(event) => setAngle(event.target.value)}
            placeholder="Ángulo: cómo querés que Kira lo trate"
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
        </section>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" className="bg-[image:var(--spectrum)]" disabled={command.pending}>
          Agregar a cola
        </Button>
      </form>
    </Card>
  );
}

interface SessionControlCardProps {
  state: AgendaSessionState;
  canActivate: boolean;
  onActivar: () => void;
  onPausaSuave: () => void;
  onEmergencia: () => void;
}

function SessionControlCard({ state, canActivate, onActivar, onPausaSuave, onEmergencia }: SessionControlCardProps) {
  const command = useMockCommand<AgendaSessionState>();
  const badge = SESSION_BADGE[state];

  function dispatch(next: AgendaSessionState, action: () => void) {
    action();
    void command.run(next);
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Control de sesión</h2>
        <div className="flex items-center gap-2">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {command.pending && <Badge tone="info">aplicando…</Badge>}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Los controles de sesión son simulados — todavía no hay un endpoint POST{" "}
          <span className="mono">/api/agenda/session</span> en el backend.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={command.pending || !canActivate}
            onClick={() => dispatch("active", onActivar)}
          >
            {state === "paused" ? "Reanudar" : "Activar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={command.pending || state !== "active"}
            onClick={() => dispatch("paused", onPausaSuave)}
          >
            Pausa suave
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-danger-bd text-danger hover:bg-danger-bg"
            disabled={command.pending || state === "off"}
            onClick={() => dispatch("off", onEmergencia)}
          >
            Emergencia
          </Button>
        </div>

        {!canActivate && state === "off" && (
          <p role="status" className="text-xs leading-relaxed text-dim">
            Activar deshabilitado: la cola de temas está vacía.
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Agenda panel — CTK parity (opencohost/ui/cohost_agenda_panel.py) as a
 * functional mock: profile + session settings, Ahora (active topic),
 * Cola (reorder/remove), Sugerencias de Kira (approve/reject), Agregar tema,
 * and Control de sesión (Activar / Pausa suave / Emergencia, state-gated).
 * All state is local (useState) seeded from AGENDA_FIXTURE — see the mock
 * hook contract note at the top of this file for the intended real-backend
 * swap.
 */
export function AgendaPanel() {
  const [profileName, setProfileName] = useState(AGENDA_FIXTURE.profile.name);
  const [turns, setTurns] = useState(String(AGENDA_FIXTURE.session_settings.max_turns_per_topic));
  const [rhythm, setRhythm] = useState<AgendaRhythm>(AGENDA_FIXTURE.session_settings.rhythm);
  const [safetyMode, setSafetyMode] = useState<AgendaSafetyMode>(AGENDA_FIXTURE.session_settings.safety_mode);
  const [now, setNow] = useState<AgendaQueueTopic | null>(AGENDA_FIXTURE.now);
  const [queue, setQueue] = useState<AgendaQueueTopic[]>(AGENDA_FIXTURE.queue);
  const [suggestions, setSuggestions] = useState<AgendaSuggestion[]>(AGENDA_FIXTURE.suggestions);
  const [sessionState, setSessionState] = useState<AgendaSessionState>(AGENDA_FIXTURE.session_state);

  function handleMove(id: string, direction: -1 | 1) {
    setQueue((prev) => moveQueueItem(prev, id, direction));
  }

  function handleRemove(id: string) {
    setQueue((prev) => prev.filter((topic) => topic.id !== id));
  }

  function handleApprove(suggestion: AgendaSuggestion) {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
    setQueue((prev) => [
      ...prev,
      { id: suggestion.id, title: suggestion.title, angle: suggestion.angle, priority: "normal" }
    ]);
  }

  function handleReject(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  function handleAddTopic(title: string, angle: string) {
    setQueue((prev) => [...prev, { id: `topic-${Date.now()}`, title, angle, priority: "normal" }]);
  }

  function handleActivar() {
    if (sessionState === "paused") {
      setSessionState("active");
      return;
    }
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    setSessionState("active");
    setNow(next);
    setQueue(rest);
  }

  function handlePausaSuave() {
    setSessionState("paused");
  }

  function handleEmergencia() {
    setSessionState("off");
    setNow(null);
  }

  return (
    <>
      <ProfileSessionCard
        name={profileName}
        onSaveName={setProfileName}
        turns={turns}
        onTurnsChange={setTurns}
        rhythm={rhythm}
        onRhythmChange={setRhythm}
        safetyMode={safetyMode}
        onSafetyModeChange={setSafetyMode}
      />
      <NowCard now={now} />
      <QueueCard queue={queue} onMove={handleMove} onRemove={handleRemove} />
      <SuggestionsCard suggestions={suggestions} onApprove={handleApprove} onReject={handleReject} />
      <AddTopicCard onAdd={handleAddTopic} />
      <SessionControlCard
        state={sessionState}
        canActivate={sessionState !== "active" && (queue.length > 0 || now !== null)}
        onActivar={handleActivar}
        onPausaSuave={handlePausaSuave}
        onEmergencia={handleEmergencia}
      />
    </>
  );
}
