import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { Input } from "./ui/Input.js";
import { Select } from "./ui/Select.js";
import { Segmented } from "./ui/Segmented.js";
import { CollapsibleHeader, CollapsibleBody, useCollapsible } from "./ui/Collapsible.js";
import { useToast } from "./ui/Toast.js";
import { Alert } from "./ui/Alert.js";
import {
  AGENDA_TURN_OPTIONS,
  useAddAgendaTopicMutation,
  useAgendaQuery,
  useAgendaSessionActionMutation,
  useAgendaTopicActionMutation,
  useCohostProfilesQuery,
  useSaveCohostProfileMutation,
  useSelectCohostProfileMutation,
  useUpdateAgendaSessionMutation,
  type AgendaSessionAction,
  type AgendaTopicOut,
  type AgendaTopicRequest
} from "../api/agenda.js";

// S10/WU-B: wired to live GET/POST/PUT /api/agenda* (opencohost/api/main.py
// ~1069-1204) — Now/Queue/Sugerencias hydrate from GET (drafted_topics is
// Kira's suggestion queue), adding a topic POSTs /api/agenda/topic, queue
// reorder/remove/approve/reject POSTs /api/agenda/topic/action, turnos/ritmo/
// modo PUT /api/agenda/session, session lifecycle (Activar/Pausa suave/
// Emergencia) POSTs /api/agenda/session/action, and the co-host style
// profile (a Kira Agenda tone preset — NOT the same thing as the LLM
// /api/perfiles profile) reads/writes through /api/agenda/cohost-profiles(
// /select). Every mutation that returns a full AgendaResponse writes it
// straight into the query cache (see useAgendaMutation in api/agenda.ts) so
// Now/Queue/Sugerencias/session settings never carry local-only state that
// could drift from the backend.

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

function confidenceBadge(confidence: string) {
  return CONFIDENCE_BADGE[confidence] ?? CONFIDENCE_BADGE.MEDIUM;
}

function sectionLabel(id: string, text: string) {
  return (
    <span id={id} className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
      {text}
    </span>
  );
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Co-host style profile (opencohost/core/cohost_profiles.py) + session
 * settings. "Perfiles guardados" hydrates from GET /api/agenda/cohost-
 * profiles; picking one applies its style to the RUNNING agenda controller
 * via POST /api/agenda/cohost-profiles/select (RAM-only — never persisted,
 * see selectCohostProfile's doc comment). "Guardar perfil" persists the
 * current style text under a name via POST /api/agenda/cohost-profiles.
 * There is no backend field mapping the running style back to a saved
 * profile NAME (AgendaSessionSettings only carries the raw `profile_style`
 * text) — selection here is a local UI concept defaulting to "Natural",
 * mirroring the CTk combo's own default (cohost_agenda_panel.py::set_profiles).
 * Turnos/ritmo/modo hydrate from GET /api/agenda and each change PUTs only
 * that one field (AgendaSessionRequest is a partial update).
 */
function ProfileSessionCard() {
  const [isOpen, toggle] = useCollapsible(true, "agenda-perfil");
  const { data } = useAgendaQuery();
  const updateSession = useUpdateAgendaSessionMutation();
  const cohostProfiles = useCohostProfilesQuery();
  const saveProfile = useSaveCohostProfileMutation();
  const selectProfile = useSelectCohostProfileMutation();

  const profiles = cohostProfiles.data?.profiles ?? [];

  const [selectedProfileName, setSelectedProfileName] = useState("Natural");
  const [draftName, setDraftName] = useState("Natural");
  const [styleDraft, setStyleDraft] = useState("");

  useEffect(() => {
    if (profiles.length === 0) return;
    const match = profiles.find((profile) => profile.name === selectedProfileName) ?? profiles[0];
    setSelectedProfileName(match.name);
    setDraftName(match.name);
    setStyleDraft(match.style);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohostProfiles.data]);

  function handleSelectProfile(name: string) {
    setSelectedProfileName(name);
    const profile = profiles.find((candidate) => candidate.name === name);
    if (profile) {
      setDraftName(profile.name);
      setStyleDraft(profile.style);
    }
    selectProfile.mutate({ name });
  }

  function handleSaveProfile() {
    const trimmed = draftName.trim();
    if (!trimmed) return;
    saveProfile.mutate({ name: trimmed, style: styleDraft });
  }

  const turns = data ? String(data.session_settings.max_turns_per_topic) : "";
  const rhythm = data?.session_settings.rhythm ?? "normal";
  const safetyMode = data?.session_settings.safety_mode ?? "live_safe";
  const pending = updateSession.isPending || selectProfile.isPending || saveProfile.isPending;

  // Split by group per spec §3e change 7 — save errors surface under the
  // save button (they belong to the profile group), session errors surface
  // atop the session group (they belong to the auto-saving fields).
  const profileErrorMessage = saveProfile.isError
    ? mutationErrorMessage(saveProfile.error, "No se pudo guardar el perfil.")
    : selectProfile.isError
      ? mutationErrorMessage(selectProfile.error, "No se pudo aplicar el perfil.")
      : null;

  const sessionErrorMessage = updateSession.isError ? "No se pudo guardar la configuración de sesión." : null;

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">Perfil Co-host</h2>
        {pending && <Badge tone="info">aplicando…</Badge>}
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <div className="flex flex-col gap-3.5">
        {/* Sesión group first (owner order 2026-07-15): auto-saving fields that
            "se aplica al instante" lead, then the divider, then the manually
            saved Identidad/Estilo profile. Session errors surface atop this
            group; profile save errors stay under the save button below. */}
        {data && (
          <section aria-labelledby="agenda-session-settings-label" className="space-y-2 pb-1">
            <div className="flex items-baseline gap-2">
              {sectionLabel("agenda-session-settings-label", "Sesión")}
              <span className="mono text-[13px] text-dim">se aplica al instante</span>
            </div>
            {sessionErrorMessage && <Alert tone="danger">{sessionErrorMessage}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Intentos por tema</span>
                <Select
                  aria-label="Intentos por tema"
                  options={AGENDA_TURN_OPTIONS}
                  value={turns}
                  disabled={updateSession.isPending}
                  className={"z-20"}
                  onChange={(value) => {
                    updateSession.mutate({ max_turns_per_topic: Number(value) });
                  }}
                />
                <span className="mono text-[11px] text-dim">
                  Cada intento es una generación del modelo; los rechazos también descuentan.
                </span>
              </div>
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Modo de seguridad en vivo</span>
                <Select
                  aria-label="Modo de seguridad en vivo"
                  options={SAFETY_MODE_OPTIONS}
                  value={safetyMode}
                  disabled={updateSession.isPending}
                  className={"z-20"}
                  onChange={(value) => {
                    updateSession.mutate({ safety_mode: value });
                  }}
                />
              </div>
            </div>
            <div className="space-y-2 space-x-2">
              <span className="text-xs text-muted-foreground">Ritmo</span>
              <Segmented
                ariaLabel="Ritmo"
                options={RHYTHM_OPTIONS}
                value={rhythm}
                disabled={updateSession.isPending}
                className="mb-1s"
                onChange={(value) => {
                  updateSession.mutate({ rhythm: value });
                }}
              />
            </div>
          </section>
        )}

        {/* Divider sits between the session group and Identidad — only when the
            session group above it actually rendered (data present). */}
        <section
          aria-labelledby="agenda-profile-label"
          className={`space-y-2 ${data ? "border-t border-border-soft pt-3.5" : ""}`}
        >
          {sectionLabel("agenda-profile-label", "Identidad")}
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Perfil guardado</span>
            <Select
              aria-label="Perfiles guardados"
              options={(profiles.length > 0 ? profiles : [{ name: selectedProfileName }]).map((profile) => ({ value: profile.name, label: profile.name }))}
              value={selectedProfileName}
              disabled={selectProfile.isPending}
              onChange={(value: any) => handleSelectProfile(value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="agenda-profile-name" className="text-xs text-muted-foreground">
              Nombre
            </label>
            <Input
              id="agenda-profile-name"
              type="text"
              aria-label="Nombre del perfil co-host"
              value={draftName}
              disabled={saveProfile.isPending}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </div>
        </section>

        <section aria-labelledby="agenda-style-label" className="space-y-2">
          {sectionLabel("agenda-style-label", "Estilo")}
          <div className="space-y-1">
            <label htmlFor="agenda-profile-style" className="text-xs text-muted-foreground">
              Cómo suena Kira
            </label>
            <textarea
              id="agenda-profile-style"
              aria-label="Estilo del perfil co-host"
              value={styleDraft}
              disabled={saveProfile.isPending}
              onChange={(event) => setStyleDraft(event.target.value)}
              rows={3}
              placeholder="Cómo querés que suene Kira…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed min-h-[100px] max-h-[300px] disabled:opacity-60"
            />
          </div>

          <div className="flex items-start justify-end gap-3">
            <p className="mr-auto text-xs text-muted-foreground">
              Guarda el nombre y el estilo como un perfil reutilizable.
            </p>
            <Button
              type="button"
              variant="primary"
              disabled={saveProfile.isPending || !draftName.trim()}
              onClick={handleSaveProfile}
            >
              {saveProfile.isPending ? "Guardando…" : "Guardar perfil"}
            </Button>
          </div>
          {profileErrorMessage && <Alert tone="danger">{profileErrorMessage}</Alert>}
        </section>
      </div>
      </CollapsibleBody>
    </Card>
  );
}

function NowCard({ now }: { now: AgendaTopicOut | null | undefined }) {
  const [isOpen, toggle] = useCollapsible(true, "agenda-ahora");
  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">Ahora</h2>
      </CollapsibleHeader>
      <CollapsibleBody isOpen={isOpen}>
      <div data-testid="agenda-now">
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
      </CollapsibleBody>
    </Card>
  );
}

function QueueCard({ queue }: { queue: AgendaTopicOut[] }) {
  const [isOpen, toggle] = useCollapsible(true, "agenda-cola");
  const action = useAgendaTopicActionMutation();

  function move(id: string, direction: -1 | 1) {
    action.mutate({ action: "move", topic_id: id, direction });
  }

  function remove(id: string) {
    action.mutate({ action: "remove", topic_id: id });
  }

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground w-full justify-between items-center">Cola de temas</h2>
        <div className="flex gap-2 w-full justify-end">
          <Badge tone="info">{queue.length} en cola</Badge>
          {action.isPending && <Badge tone="info">aplicando…</Badge>}
        </div>
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <div className="flex flex-col gap-3.5">
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
      </CollapsibleBody>
    </Card>
  );
}

interface SuggestionsCardProps {
  suggestions: AgendaTopicOut[];
}

/**
 * Kira's drafted topics (`drafted_topics` on GET /api/agenda) — approve
 * queues the topic (POST /api/agenda/topic/action, action=approve) and
 * reject dismisses it (action=reject). Both are whitelisted verbs on
 * `_AGENDA_ACTION_WHITELIST` (opencohost/api/main.py).
 */
function SuggestionsCard({ suggestions }: SuggestionsCardProps) {
  const [isOpen, toggle] = useCollapsible(true, "agenda-sugerencias");
  const action = useAgendaTopicActionMutation();

  function approve(id: string) {
    action.mutate({ action: "approve", topic_id: id });
  }

  function reject(id: string) {
    action.mutate({ action: "reject", topic_id: id });
  }

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">Sugerencias de Kira</h2>
        {action.isPending && <Badge tone="info">aplicando…</Badge>}
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <div className="flex flex-col gap-3.5">
        {action.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            No se pudo aplicar la acción sobre la sugerencia.
          </p>
        )}

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin sugerencias pendientes.</p>
        ) : (
          <ul aria-label="Sugerencias de Kira" className="flex flex-col gap-2">
            {suggestions.map((topic) => {
              const badge = confidenceBadge(topic.confidence);
              return (
                <li
                  key={topic.id}
                  aria-label={topic.title}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-border-soft bg-background p-3"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{topic.title}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{topic.angle || "Sin ángulo"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={action.isPending}
                      aria-label={`Aprobar "${topic.title}"`}
                      onClick={() => approve(topic.id)}
                    >
                      Aprobar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={action.isPending}
                      aria-label={`Rechazar "${topic.title}"`}
                      onClick={() => reject(topic.id)}
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
      </CollapsibleBody>
    </Card>
  );
}

const PRIORITY_OPTIONS = [
  { value: "alta", label: "Alta" },
  { value: "normal", label: "Normal" },
  { value: "baja", label: "Baja" }
] as const;

const RESPONSE_LENGTH_OPTIONS = [
  { value: "corta", label: "Corta" },
  { value: "normal", label: "Normal" },
  { value: "expandida", label: "Expandida" }
] as const;

const MAX_CONSTRAINTS = 12;
const MAX_CONSTRAINT_LEN = 120;

interface TemplateTopic {
  title: string;
  angle: string;
  priority: string;
  response_length: string;
  constraints: string[];
}

// 5 test topics (exploration map #2978) — clicking one prefills the form so
// the operator can tweak and queue, mirroring the CTk quick-topic presets.
const TEMPLATE_TOPICS: TemplateTopic[] = [
  { title: "Nostalgia de los 2000 en gaming", angle: "Qué volvió y por qué pega ahora", priority: "normal", response_length: "normal", constraints: ["sin spoilers", "tono liviano"] },
  { title: "Burnout de streamers", angle: "Señales tempranas y cómo cortar a tiempo", priority: "alta", response_length: "expandida", constraints: ["empático", "sin nombres propios"] },
  { title: "IA generativa en overlays", angle: "Dónde está la línea entre herramienta y reemplazo", priority: "normal", response_length: "normal", constraints: ["equilibrado"] },
  { title: "Memes viejos que el chat repite", angle: "Por qué la comunidad recicla nostalgia", priority: "baja", response_length: "corta", constraints: ["humor seco"] },
  { title: "Mods como cultura popular", angle: "Cómo redefinen juegos viejos", priority: "normal", response_length: "normal", constraints: ["ejemplos concretos"] }
];

// Strip emoji + code-like punctuation, trim, cap length — mirrors the backend
// sanitize (opencohost/api/models.py::AgendaTopicRequest, WU7). ponytail: the
// server still validates and 422s on >24 constraints; the UI caps at 12 so it
// never trips that ceiling.
function sanitizeConstraint(raw: string): string {
  return raw
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/[`<>{}]/g, "")
    .trim()
    .slice(0, MAX_CONSTRAINT_LEN);
}

/** Parse one bulk line `Título | ángulo | prioridad | tags(coma-sep)`. Blank
 * (title-less) lines return null so the caller drops them. */
function parseBulkLine(line: string): AgendaTopicRequest | null {
  const parts = line.split("|").map((part) => part.trim());
  const title = parts[0] ?? "";
  if (!title) return null;
  const constraints = (parts[3] ?? "")
    .split(",")
    .map(sanitizeConstraint)
    .filter(Boolean)
    .slice(0, MAX_CONSTRAINTS);
  return {
    title,
    angle: parts[1] ?? "",
    priority: (parts[2] || "normal").toLowerCase(),
    response_length: "normal",
    constraints
  };
}

function AddTopicCard() {
  const [isOpen, toggle] = useCollapsible(true, "agenda-agregar");
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [responseLength, setResponseLength] = useState("normal");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [constraintDraft, setConstraintDraft] = useState("");
  const [constraintWarn, setConstraintWarn] = useState<string | null>(null);
  const [bulk, setBulk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const addTopic = useAddAgendaTopicMutation();

  function addConstraint(raw: string) {
    const clean = sanitizeConstraint(raw);
    setConstraintDraft("");
    if (!clean || constraints.includes(clean)) return;
    if (constraints.length >= MAX_CONSTRAINTS) {
      setConstraintWarn(`Máximo ${MAX_CONSTRAINTS} etiquetas.`);
      return;
    }
    setConstraintWarn(null);
    setConstraints((prev) =>
      prev.includes(clean) || prev.length >= MAX_CONSTRAINTS ? prev : [...prev, clean]
    );
  }

  function removeConstraint(value: string) {
    setConstraintWarn(null);
    setConstraints((prev) => prev.filter((c) => c !== value));
  }

  function resetForm() {
    setTitle("");
    setAngle("");
    setPriority("normal");
    setResponseLength("normal");
    setConstraints([]);
    setConstraintDraft("");
    setConstraintWarn(null);
  }

  function applyTemplate(template: TemplateTopic) {
    setTitle(template.title);
    setAngle(template.angle);
    setPriority(template.priority);
    setResponseLength(template.response_length);
    setConstraints(template.constraints);
    setConstraintDraft("");
    setConstraintWarn(null);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("El título no puede estar vacío.");
      return;
    }
    setError(null);
    addTopic.mutate(
      { title: trimmedTitle, angle: angle.trim(), priority, response_length: responseLength, constraints },
      {
        onSuccess: resetForm,
        onError: (mutationError) => {
          setError(mutationErrorMessage(mutationError, "No se pudo agregar el tema."));
        }
      }
    );
  }

  // Bulk: one POST per parsed line, sequential so the LAST AgendaResponse is
  // the one left in the query cache. Backend dedups by (title, angle) so a
  // partial-failure retry of the whole block is safe.
  async function handleBulkSubmit() {
    const topics = bulk.split("\n").map(parseBulkLine).filter((t): t is AgendaTopicRequest => t !== null);
    if (topics.length === 0) {
      setError("No hay temas válidos en el bloque.");
      return;
    }
    setError(null);
    try {
      for (const topic of topics) {
        await addTopic.mutateAsync(topic);
      }
      setBulk("");
    } catch (mutationError) {
      setError(mutationErrorMessage(mutationError, "No se pudo agregar el lote."));
    }
  }

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">Agregar tema</h2>
        {addTopic.isPending && <Badge tone="info">aplicando…</Badge>}
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <section aria-labelledby="agenda-add-topic-label" className="space-y-2">
          {sectionLabel("agenda-add-topic-label", "Tema aprobado")}
          <Input
            type="text"
            aria-label="Título del tema"
            value={title}
            disabled={addTopic.isPending}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tema claro, máximo 90 caracteres"
          />
          <Input
            type="text"
            aria-label="Ángulo (opcional)"
            value={angle}
            disabled={addTopic.isPending}
            onChange={(event) => setAngle(event.target.value)}
            placeholder="Ángulo: cómo querés que Kira lo trate"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Prioridad</span>
              <Select
                aria-label="Prioridad"
                options={PRIORITY_OPTIONS}
                value={priority}
                disabled={addTopic.isPending}
                onChange={(value) => setPriority(value)}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Largo de respuesta</span>
              <Select
                aria-label="Largo de respuesta"
                options={RESPONSE_LENGTH_OPTIONS}
                value={responseLength}
                disabled={addTopic.isPending}
                onChange={(value) => setResponseLength(value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Etiquetas</span>
            <Input
              type="text"
              aria-label="Etiquetas (constraints)"
              value={constraintDraft}
              disabled={addTopic.isPending}
              onChange={(event) => setConstraintDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addConstraint(constraintDraft);
                }
              }}
              placeholder="Enter o coma para agregar (máx. 12)"
            />
            {constraints.length > 0 && (
              <ul aria-label="Etiquetas agregadas" className="flex flex-wrap gap-1.5">
                {constraints.map((constraint) => (
                  <li
                    key={constraint}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-foreground"
                  >
                    {constraint}
                    <button
                      type="button"
                      aria-label={`Quitar etiqueta ${constraint}`}
                      onClick={() => removeConstraint(constraint)}
                      className="text-dim transition-colors duration-fast ease-io hover:text-danger"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {constraintWarn && <p className="text-xs text-warn">{constraintWarn}</p>}
          </div>
        </section>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={addTopic.isPending}>
          Agregar a cola
        </Button>

        <div className="flex items-center gap-2 py-1">
          <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
          <span className="text-xs text-dim">o en lote</span>
          <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
        </div>

        <section aria-labelledby="agenda-bulk-label" className="space-y-2">
          {sectionLabel("agenda-bulk-label", "Carga en lote")}
          <textarea
            aria-label="Temas en lote"
            value={bulk}
            disabled={addTopic.isPending}
            onChange={(event) => setBulk(event.target.value)}
            rows={4}
            placeholder="Un tema por línea: Título | ángulo | prioridad | tag1, tag2"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed min-h-[100px] max-h-[500px] disabled:opacity-60"
          />
          <Button type="button" variant="outline" disabled={addTopic.isPending} onClick={handleBulkSubmit}>
            Agregar en lote
          </Button>
        </section>

        <div className="flex items-center gap-2 py-1">
          <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
          <span className="text-xs text-dim">plantillas de prueba</span>
          <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_TOPICS.map((template) => (
            <Button
              key={template.title}
              type="button"
              variant="ghost"
              className="h-8 rounded-md border border-border-soft px-3 py-3 text-xs"
              disabled={addTopic.isPending}
              aria-label={`Plantilla: ${template.title}`}
              onClick={() => applyTemplate(template)}
            >
              {template.title}
            </Button>
          ))}
        </div>
      </form>
      </CollapsibleBody>
    </Card>
  );
}

const SESSION_ACTIONS: Array<{ action: AgendaSessionAction; label: string; variant: "primary" | "outline"; className?: string }> = [
  { action: "enable", label: "Activar", variant: "primary" },
  { action: "soft_stop", label: "Pausa suave", variant: "outline" },
  { action: "emergency_stop", label: "Emergencia", variant: "outline", className: "border-danger-bd text-danger hover:bg-danger-bg" }
];

/**
 * Session lifecycle — Activar/Pausa suave/Emergencia POST
 * /api/agenda/session/action with action=enable|soft_stop|emergency_stop
 * (whitelisted server-side against `_AGENDA_SESSION_ACTION_WHITELIST`,
 * opencohost/api/main.py). All three disable while any is pending; a
 * rejected action surfaces an alert instead of failing silently.
 */
function SessionControlCard({ state, queueLength }: { state: string; queueLength: number }) {
  const [isOpen, toggle] = useCollapsible(true, "agenda-sesion");
  const badge = sessionBadge(state);
  const action = useAgendaSessionActionMutation();

  // CTK parity (FIX-C): the backend refuses `enable` on an empty queue with a
  // 200 + applied=false/reason="empty_queue" instead of starting a silent
  // session. Surface it so the operator knows to add or approve a topic first.
  // F4: also gate on the LIVE queue (queueLength from useAgendaQuery) so the
  // alert clears the moment the operator adds/approves a topic — otherwise it
  // would linger, stuck on the stale session-action response.
  const emptyQueue =
    queueLength === 0 && action.data?.applied === false && action.data.reason === "empty_queue";

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground w-full">Control de sesión</h2>
        <div className="flex items-center gap-2">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {action.isPending && <Badge tone="info">aplicando…</Badge>}
        </div>
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <div className="flex flex-col gap-3.5">
        {action.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            No se pudo aplicar la acción de sesión.
          </p>
        )}

        {emptyQueue && (
          <p role="alert" className="text-xs leading-relaxed text-warn">
            No hay temas en cola — agregá o aprobá un tema primero.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {SESSION_ACTIONS.map((entry) => (
            <Button
              key={entry.action}
              type="button"
              variant={entry.variant}
              className={entry.className}
              disabled={action.isPending}
              onClick={() => action.mutate({ action: entry.action })}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>
      </CollapsibleBody>
    </Card>
  );
}

function TestToastsCard() {
  const { toast } = useToast();
  return (
    <Card className="flex flex-col p-4 gap-3">
      <h2 className="text-sm font-bold text-foreground">Probar Toasts</h2>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => toast("¡Perfil guardado con éxito!", { tone: "ok" })}>Éxito</Button>
        <Button onClick={() => toast("Error de red al intentar conectar", { tone: "danger" })}>Error</Button>
        <Button onClick={() => toast("La sesión entró en pausa suave", { tone: "warn" })}>Advertencia</Button>
        <Button onClick={() => toast("Kira sugirió un nuevo tema", { tone: "info" })}>Info</Button>
        <Button onClick={() => toast("ID copiado al portapapeles", { tone: "neutral" })}>Neutral</Button>
      </div>
    </Card>
  );
}

/**
 * Agenda panel — CTK parity (opencohost/ui/cohost_agenda_panel.py): profile
 * + session settings, Ahora (active topic), Cola (reorder/remove),
 * Sugerencias de Kira (approve/reject from drafted_topics), Agregar tema,
 * and Control de sesión (Activar/Pausa suave/Emergencia). See the
 * module-level note above for the exact backend routes each section uses.
 */
export function AgendaPanel() {
  const { data, isError: getError } = useAgendaQuery();

  const queue = data?.queued_topics ?? [];
  const suggestions = data?.drafted_topics ?? [];

  return (
    <>
      {/* <TestToastsCard /> */}
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
      <SuggestionsCard suggestions={suggestions} />
      <SessionControlCard state={data?.state ?? data?.metrics.current_state ?? "OFF"} queueLength={queue.length} />
    </>
  );
}
