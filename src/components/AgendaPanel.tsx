import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { Select } from "./ui/Select.js";
import { Segmented } from "./ui/Segmented.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import { AGENDA_FIXTURE, type AgendaSuggestion } from "../api/mock/fixtures.js";
import {
  useAddAgendaTopicMutation,
  useAgendaQuery,
  useAgendaTopicActionMutation,
  useUpdateAgendaSessionMutation,
  type AgendaTopicOut
} from "../api/agenda.js";
import { useStatusQuery } from "../api/status.js";

// S10: wired to live GET/POST/PUT /api/agenda* (opencohost/api/main.py
// ~472-533) — Now/Queue hydrate from GET, adding a topic POSTs
// /api/agenda/topic, queue reorder/remove POSTs /api/agenda/topic/action,
// and turnos/ritmo/modo PUT /api/agenda/session. Every mutation writes the
// full AgendaResponse it gets back straight into the query cache (see
// useAgendaMutation in api/agenda.ts) so Now/Queue/session settings never
// carry local-only queue state that could drift from the backend.
//
// Deferred (kept as an honest local mock, see the disclosure note in each
// section): Kira's auto-suggestion generation (no backend route to draft
// suggestions) and session ACTIVATION (Activar / Pausa suave / Emergencia —
// no backend verb exists for KiraAgendaController's session lifecycle yet).

const RHYTHM_OPTIONS = [
  { value: "calmo", label: "Calmo" },
  { value: "normal", label: "Normal" },
  { value: "dinamico", label: "Dinámico" }
] as const;

const SAFETY_MODE_OPTIONS = [
  { value: "live_safe", label: "Live-safe" },
  { value: "monologue", label: "Monólogo" },
  { value: "test", label: "Test" }
] as const;

const TURN_OPTIONS = ["1", "2", "3", "5", "8"] as const;

const PRIORITY_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  alta: { tone: "warn", label: "Alta" },
  normal: { tone: "info", label: "Normal" },
  baja: { tone: "ok", label: "Baja" }
};

const CONFIDENCE_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  HIGH: { tone: "ok", label: "confianza alta" },
  MEDIUM: { tone: "info", label: "confianza media" },
  LOW: { tone: "warn", label: "confianza baja" }
};

// Live session states from opencohost/smart_aggregator/kira_agenda_controller.py::AgendaState.
// ponytail: only the states CTk's _update_session_buttons treats specially get a distinct
// label/tone; everything else (the "active_states" set) falls back to "activa" below.
const SESSION_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  OFF: { tone: "info", label: "inactiva" },
  PAUSED_NEEDS_OPERATOR: { tone: "warn", label: "pausa suave" },
  HARD_PAUSED: { tone: "danger", label: "pausa dura" }
};

function sessionBadge(state: string): { tone: BadgeTone; label: string } {
  return SESSION_BADGE[state] ?? { tone: "ok", label: "activa" };
}

function priorityBadge(priority: string) {
  return PRIORITY_BADGE[priority] ?? PRIORITY_BADGE.normal;
}

function sectionLabel(id: string, text: string) {
  return (
    <span id={id} className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
      {text}
    </span>
  );
}

/**
 * Session settings — turnos/ritmo/modo hydrate from GET /api/agenda and
 * each change PUTs only that one field (AgendaSessionRequest is a partial
 * update; an omitted field leaves the stored value unchanged). The profile
 * NAME has no field on AgendaSessionSettings (only `profile_style`, a style
 * knob, not a name) — the real active profile name lives on GET
 * /api/status.active_profile (same field the CTk profile panel mirrors),
 * so that's the seed here. Saving a new name is still a local-only mock —
 * no backend rename verb exists — disclosed below.
 */
function ProfileSessionCard() {
  const { data } = useAgendaQuery();
  const { data: status } = useStatusQuery();
  const updateSession = useUpdateAgendaSessionMutation();
  const liveProfileName = status?.active_profile ?? AGENDA_FIXTURE.profile.name;
  const [profileName, setProfileName] = useState(liveProfileName);
  const [draftName, setDraftName] = useState(liveProfileName);
  const nameCommand = useMockCommand<string>();

  useEffect(() => {
    if (status?.active_profile) {
      setProfileName(status.active_profile);
      setDraftName(status.active_profile);
    }
  }, [status?.active_profile]);

  const turns = data ? String(data.session_settings.max_turns_per_topic) : "";
  const rhythm = data?.session_settings.rhythm ?? "normal";
  const safetyMode = data?.session_settings.safety_mode ?? "live_safe";
  const pending = nameCommand.pending || updateSession.isPending;

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Perfil Co-host</h2>
        {pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {updateSession.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            No se pudo guardar la configuración de sesión.
          </p>
        )}

        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          El nombre mostrado viene de <span className="mono">GET /api/status.active_profile</span> — guardarlo acá es
          solo una vista previa local, no existe todavía un verbo de backend para renombrar el perfil.
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
                setProfileName(trimmed);
                void nameCommand.run(trimmed);
              }}
            >
              Guardar perfil
            </Button>
          </div>
          <p className="sr-only">{profileName}</p>
        </section>

        {data && (
          <section aria-labelledby="agenda-session-settings-label" className="space-y-2">
            {sectionLabel("agenda-session-settings-label", "Configuración de sesión")}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Turnos por tema</span>
                <Select
                  aria-label="Turnos por tema"
                  value={turns}
                  disabled={updateSession.isPending}
                  onChange={(event) => {
                    updateSession.mutate({ max_turns_per_topic: Number(event.target.value) });
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
                  disabled={updateSession.isPending}
                  onChange={(event) => {
                    updateSession.mutate({ safety_mode: event.target.value });
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
              disabled={updateSession.isPending}
              onChange={(value) => {
                updateSession.mutate({ rhythm: value });
              }}
            />
          </section>
        )}
      </div>
    </Card>
  );
}

function NowCard({ now }: { now: AgendaTopicOut | null | undefined }) {
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

function QueueCard({ queue }: { queue: AgendaTopicOut[] }) {
  const action = useAgendaTopicActionMutation();

  function move(id: string, direction: -1 | 1) {
    action.mutate({ action: "move", topic_id: id, direction });
  }

  function remove(id: string) {
    action.mutate({ action: "remove", topic_id: id });
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Cola de temas</h2>
        <div className="flex items-center gap-2">
          <Badge tone="info">{queue.length} en cola</Badge>
          {action.isPending && <Badge tone="info">aplicando…</Badge>}
        </div>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {action.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            No se pudo aplicar la acción sobre la cola.
          </p>
        )}

        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay temas en cola todavía.</p>
        ) : (
          <ol aria-label="Cola de temas ordenada" className="flex flex-col gap-2">
            {queue.map((topic, index) => {
              const badge = priorityBadge(topic.priority);
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
                      disabled={action.isPending || index === 0}
                      onClick={() => move(topic.id, -1)}
                    >
                      ▲
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      aria-label={`Bajar "${topic.title}"`}
                      disabled={action.isPending || index === queue.length - 1}
                      onClick={() => move(topic.id, 1)}
                    >
                      ▼
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-danger"
                      aria-label={`Quitar "${topic.title}"`}
                      disabled={action.isPending}
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

function AddTopicCard() {
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const addTopic = useAddAgendaTopicMutation();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("El título no puede estar vacío.");
      return;
    }
    setError(null);
    addTopic.mutate(
      { title: trimmedTitle, angle: angle.trim() },
      {
        onSuccess: () => {
          setTitle("");
          setAngle("");
        },
        onError: (mutationError) => {
          setError(mutationError instanceof Error ? mutationError.message : "No se pudo agregar el tema.");
        }
      }
    );
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Agregar tema</h2>
        {addTopic.isPending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 pt-3.5">
        <section aria-labelledby="agenda-add-topic-label" className="space-y-2">
          {sectionLabel("agenda-add-topic-label", "Tema aprobado")}
          <input
            type="text"
            aria-label="Título del tema"
            value={title}
            disabled={addTopic.isPending}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tema claro, máximo 90 caracteres"
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
          <input
            type="text"
            aria-label="Ángulo (opcional)"
            value={angle}
            disabled={addTopic.isPending}
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

        <Button type="submit" variant="primary" className="bg-[image:var(--spectrum)]" disabled={addTopic.isPending}>
          Agregar a cola
        </Button>
      </form>
    </Card>
  );
}

function SessionControlCard({ state }: { state: string }) {
  const badge = sessionBadge(state);
  const disabledReason = "No existe un endpoint POST de activación todavía — ver nota debajo.";

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Control de sesión</h2>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p id="agenda-session-activation-note" role="status" className="text-xs leading-relaxed text-muted-foreground">
          Los controles de sesión están deshabilitados — no existe todavía un endpoint POST para activación,{" "}
          <span className="mono">/api/agenda/session</span> solo acepta PUT de configuración.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <Button
            type="button"
            variant="primary"
            disabled
            title={disabledReason}
            aria-describedby="agenda-session-activation-note"
          >
            Activar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled
            title={disabledReason}
            aria-describedby="agenda-session-activation-note"
          >
            Pausa suave
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-danger-bd text-danger hover:bg-danger-bg"
            disabled
            title={disabledReason}
            aria-describedby="agenda-session-activation-note"
          >
            Emergencia
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Agenda panel — CTK parity (opencohost/ui/cohost_agenda_panel.py): profile
 * + session settings, Ahora (active topic), Cola (reorder/remove),
 * Sugerencias de Kira (approve/reject, local mock), Agregar tema, and
 * Control de sesión (local mock — no activation verb on the backend yet).
 * See the module-level note above for exactly what is wired vs. deferred.
 */
export function AgendaPanel() {
  const { data, isError: getError } = useAgendaQuery();
  const [suggestions, setSuggestions] = useState<AgendaSuggestion[]>(AGENDA_FIXTURE.suggestions);

  function handleApprove(suggestion: AgendaSuggestion) {
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
  }

  function handleReject(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  const queue = data?.queued_topics ?? [];

  return (
    <>
      <ProfileSessionCard />
      {getError ? (
        <Card className="flex flex-col p-4">
          <p role="alert" className="text-xs leading-relaxed text-danger">
            No se pudo cargar la agenda en vivo.
          </p>
        </Card>
      ) : (
        <>
          <NowCard now={data?.active_topic} />
          <QueueCard queue={queue} />
          <AddTopicCard />
        </>
      )}
      <SuggestionsCard suggestions={suggestions} onApprove={handleApprove} onReject={handleReject} />
      <SessionControlCard state={data?.state ?? data?.metrics.current_state ?? "OFF"} />
    </>
  );
}
