import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import type { BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { Select } from "../../ui/Select.js";
import { Segmented } from "../../ui/Segmented.js";
import { CollapsibleHeader, CollapsibleBody, useCollapsible } from "../../ui/Collapsible.js";
import { useToast } from "../../ui/Toast.js";
import { Alert } from "../../ui/Alert.js";
import { usePaneSwitcher } from "../../ui/PaneSwitcher.js";
import { SettingsSection } from "../shell/SettingsSection.js";
import { t, useT, type TKey } from "../../i18n/t.js";
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
} from "../../api/agenda.js";

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
  { value: "calmo", labelKey: "agenda.session.rhythm.calmo" },
  { value: "normal", labelKey: "agenda.session.rhythm.normal" },
  { value: "dinamico", labelKey: "agenda.session.rhythm.dinamico" }
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;

const SAFETY_MODE_OPTIONS = [
  { value: "live_safe", labelKey: "agenda.session.safetyMode.liveSafe" },
  { value: "monologue", labelKey: "agenda.session.safetyMode.monologue" },
  { value: "test", labelKey: "agenda.session.safetyMode.test" }
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;

const PRIORITY_BADGE: Record<string, { tone: BadgeTone; labelKey: TKey }> = {
  alta: { tone: "warn", labelKey: "agenda.queue.priority.alta" },
  normal: { tone: "info", labelKey: "agenda.queue.priority.normal" },
  baja: { tone: "ok", labelKey: "agenda.queue.priority.baja" }
};

const CONFIDENCE_BADGE: Record<string, { tone: BadgeTone; labelKey: TKey }> = {
  HIGH: { tone: "ok", labelKey: "agenda.suggestions.confidence.high" },
  MEDIUM: { tone: "info", labelKey: "agenda.suggestions.confidence.medium" },
  LOW: { tone: "warn", labelKey: "agenda.suggestions.confidence.low" }
};

// Live session states from opencohost/smart_aggregator/kira_agenda_controller.py::AgendaState.
// ponytail: only the states CTk's _update_session_buttons treats specially get a distinct
// label/tone; everything else (the "active_states" set) falls back to "activa" below.
const SESSION_BADGE: Record<string, { tone: BadgeTone; labelKey: TKey }> = {
  OFF: { tone: "info", labelKey: "agenda.sessionControl.state.off" },
  PAUSED_NEEDS_OPERATOR: { tone: "warn", labelKey: "agenda.sessionControl.state.pausedNeedsOperator" },
  HARD_PAUSED: { tone: "danger", labelKey: "agenda.sessionControl.state.hardPaused" }
};

function sessionBadge(state: string): { tone: BadgeTone; label: string } {
  const entry = SESSION_BADGE[state] ?? { tone: "ok" as BadgeTone, labelKey: "agenda.sessionControl.state.active" as TKey };
  return { tone: entry.tone, label: t(entry.labelKey) };
}

function priorityBadge(priority: string) {
  const entry = PRIORITY_BADGE[priority] ?? PRIORITY_BADGE.normal;
  return { tone: entry.tone, label: t(entry.labelKey) };
}

function confidenceBadge(confidence: string) {
  const entry = CONFIDENCE_BADGE[confidence] ?? CONFIDENCE_BADGE.MEDIUM;
  return { tone: entry.tone, label: t(entry.labelKey) };
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

/** A form error is EITHER a bundle key (resolved at render time, so it
 * survives a locale flip) OR raw text from a thrown Error — a backend/network
 * message that was never translated copy to begin with, so there's nothing to
 * re-resolve. */
type FormError = { key: TKey } | { text: string };

function mutationErrorState(error: unknown, fallbackKey: TKey): FormError {
  return error instanceof Error ? { text: error.message } : { key: fallbackKey };
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
  const t = useT();
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
    ? mutationErrorMessage(saveProfile.error, t("agenda.profile.save.error"))
    : selectProfile.isError
      ? mutationErrorMessage(selectProfile.error, t("agenda.profile.select.error"))
      : null;

  const sessionErrorMessage = updateSession.isError ? t("agenda.session.save.error") : null;

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">{t("agenda.profile.title")}</h2>
        {pending && <Badge tone="info">{t("agenda.profile.pending")}</Badge>}
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
              {sectionLabel("agenda-session-settings-label", t("agenda.session.eyebrow"))}
              <span className="mono text-[13px] text-dim">{t("agenda.session.instant.hint")}</span>
            </div>
            {sessionErrorMessage && <Alert tone="danger">{sessionErrorMessage}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">{t("agenda.session.turns")}</span>
                <Select
                  aria-label={t("agenda.session.turns")}
                  options={AGENDA_TURN_OPTIONS}
                  value={turns}
                  disabled={updateSession.isPending}
                  onChange={(value) => {
                    updateSession.mutate({ max_turns_per_topic: Number(value) });
                  }}
                />
                <span className="mono text-[11px] text-dim">{t("agenda.session.turns.hint")}</span>
              </div>
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">{t("agenda.session.safetyMode")}</span>
                <Select
                  aria-label={t("agenda.session.safetyMode")}
                  options={SAFETY_MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                  value={safetyMode}
                  disabled={updateSession.isPending}
                  onChange={(value: string) => {
                    updateSession.mutate({ safety_mode: value });
                  }}
                />
              </div>
            </div>
            <div className="space-y-2 space-x-2">
              <span className="text-xs text-muted-foreground">{t("agenda.session.rhythm")}</span>
              <Segmented
                ariaLabel={t("agenda.session.rhythm")}
                options={RHYTHM_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
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
          {sectionLabel("agenda-profile-label", t("agenda.profile.identity.eyebrow"))}
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t("agenda.profile.saved.label")}</span>
            <Select
              aria-label={t("agenda.profile.saved.aria")}
              options={(profiles.length > 0 ? profiles : [{ name: selectedProfileName }]).map((profile) => ({ value: profile.name, label: profile.name }))}
              value={selectedProfileName}
              disabled={selectProfile.isPending}
              onChange={(value: any) => handleSelectProfile(value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="agenda-profile-name" className="text-xs text-muted-foreground">
              {t("agenda.profile.name.label")}
            </label>
            <Input
              id="agenda-profile-name"
              type="text"
              aria-label={t("agenda.profile.name.aria")}
              value={draftName}
              disabled={saveProfile.isPending}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </div>
        </section>

        <section aria-labelledby="agenda-style-label" className="space-y-2">
          {sectionLabel("agenda-style-label", t("agenda.profile.style.eyebrow"))}
          <div className="space-y-1">
            <label htmlFor="agenda-profile-style" className="text-xs text-muted-foreground">
              {t("agenda.profile.style.label")}
            </label>
            <textarea
              id="agenda-profile-style"
              aria-label={t("agenda.profile.style.aria")}
              value={styleDraft}
              disabled={saveProfile.isPending}
              onChange={(event) => setStyleDraft(event.target.value)}
              rows={3}
              placeholder={t("agenda.profile.style.placeholder")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed min-h-[100px] max-h-[300px] disabled:opacity-60"
            />
          </div>

          <div className="flex items-start justify-end gap-3">
            <p className="mr-auto text-xs text-muted-foreground">
              {t("agenda.profile.save.hint")}
            </p>
            <Button
              type="button"
              variant="primary"
              disabled={saveProfile.isPending || !draftName.trim()}
              onClick={handleSaveProfile}
            >
              {saveProfile.isPending ? t("agenda.profile.save.action.pending") : t("agenda.profile.save.action")}
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
  const t = useT();
  const [isOpen, toggle] = useCollapsible(true, "agenda-ahora");
  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">{t("agenda.now.title")}</h2>
      </CollapsibleHeader>
      <CollapsibleBody isOpen={isOpen}>
      <div data-testid="agenda-now">
        {now ? (
          <div className="flex flex-col gap-2 rounded-md bg-[image:var(--spectrum-soft)] p-3">
            <Badge tone="ok" className="w-fit">
              {t("agenda.now.live")}
            </Badge>
            <p className="text-sm font-semibold text-[var(--kira-cyan)]">{now.title}</p>
            {now.angle && <p className="text-xs leading-relaxed text-muted-foreground">{now.angle}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("agenda.now.empty")}</p>
        )}
      </div>
      </CollapsibleBody>
    </Card>
  );
}

function QueueCard({ queue }: { queue: AgendaTopicOut[] }) {
  const t = useT();
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
        <h2 className="text-sm font-bold text-foreground w-full justify-between items-center">{t("agenda.queue.title")}</h2>
        <div className="flex gap-2 w-full justify-end">
          <Badge tone="info">{t("agenda.queue.count", { n: queue.length })}</Badge>
          {action.isPending && <Badge tone="info">{t("agenda.queue.pending")}</Badge>}
        </div>
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <div className="flex flex-col gap-3.5">
        {action.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t("agenda.queue.action.error")}
          </p>
        )}

        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("agenda.queue.empty")}</p>
        ) : (
          <ol aria-label={t("agenda.queue.list.aria")} className="flex flex-col gap-2">
            {queue.map((topic, index) => {
              const badge = priorityBadge(topic.priority);
              return (
                <li
                  key={topic.id}
                  aria-label={t("agenda.queue.item.aria", { title: topic.title })}
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
                      aria-label={t("agenda.queue.moveUp.aria", { title: topic.title })}
                      disabled={action.isPending || index === 0}
                      onClick={() => move(topic.id, -1)}
                    >
                      ▲
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      aria-label={t("agenda.queue.moveDown.aria", { title: topic.title })}
                      disabled={action.isPending || index === queue.length - 1}
                      onClick={() => move(topic.id, 1)}
                    >
                      ▼
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-danger"
                      aria-label={t("agenda.queue.remove.aria", { title: topic.title })}
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
  const t = useT();
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
        <h2 className="text-sm font-bold text-foreground">{t("agenda.suggestions.title")}</h2>
        {action.isPending && <Badge tone="info">{t("agenda.suggestions.pending")}</Badge>}
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <div className="flex flex-col gap-3.5">
        {action.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t("agenda.suggestions.action.error")}
          </p>
        )}

        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("agenda.suggestions.empty")}</p>
        ) : (
          <ul aria-label={t("agenda.suggestions.title")} className="flex flex-col gap-2">
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
                    <span className="text-xs text-muted-foreground">{topic.angle || t("agenda.suggestions.angle.empty")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={action.isPending}
                      aria-label={t("agenda.suggestions.approve.aria", { title: topic.title })}
                      onClick={() => approve(topic.id)}
                    >
                      {t("agenda.suggestions.approve.action")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={action.isPending}
                      aria-label={t("agenda.suggestions.reject.aria", { title: topic.title })}
                      onClick={() => reject(topic.id)}
                    >
                      {t("agenda.suggestions.reject.action")}
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
  { value: "alta", labelKey: "agenda.topic.priority.alta" },
  { value: "normal", labelKey: "agenda.topic.priority.normal" },
  { value: "baja", labelKey: "agenda.topic.priority.baja" }
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;

const RESPONSE_LENGTH_OPTIONS = [
  { value: "corta", labelKey: "agenda.topic.responseLength.corta" },
  { value: "normal", labelKey: "agenda.topic.responseLength.normal" },
  { value: "expandida", labelKey: "agenda.topic.responseLength.expandida" }
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;

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
  const t = useT();
  const [isOpen, toggle] = useCollapsible(true, "agenda-agregar");
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [responseLength, setResponseLength] = useState("normal");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [constraintDraft, setConstraintDraft] = useState("");
  // Holds the KEY, not the resolved text — see handleSubmit's `error` state
  // below for why (resolving at click time and storing the string freezes it
  // at the boot locale; a later flip would leave a stale-language warning on
  // screen).
  const [constraintWarn, setConstraintWarn] = useState<TKey | null>(null);
  const [bulk, setBulk] = useState("");
  // `error` holds either a bundle key (validation) or the raw message from a
  // thrown Error (mutationErrorState below) — never a pre-resolved string, so
  // a locale flip re-renders it correctly instead of freezing whatever was
  // displayed at submit time.
  const [error, setError] = useState<FormError | null>(null);
  const addTopic = useAddAgendaTopicMutation();

  function addConstraint(raw: string) {
    const clean = sanitizeConstraint(raw);
    setConstraintDraft("");
    if (!clean || constraints.includes(clean)) return;
    if (constraints.length >= MAX_CONSTRAINTS) {
      setConstraintWarn("agenda.constraints.max");
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
      setError({ key: "agenda.topic.title.error" });
      return;
    }
    setError(null);
    addTopic.mutate(
      { title: trimmedTitle, angle: angle.trim(), priority, response_length: responseLength, constraints },
      {
        onSuccess: resetForm,
        onError: (mutationError) => {
          setError(mutationErrorState(mutationError, "agenda.topic.add.error"));
        }
      }
    );
  }

  // Bulk: one POST per parsed line, sequential so the LAST AgendaResponse is
  // the one left in the query cache. Backend dedups by (title, angle) so a
  // partial-failure retry of the whole block is safe.
  async function handleBulkSubmit() {
    const topics = bulk.split("\n").map(parseBulkLine).filter((line): line is AgendaTopicRequest => line !== null);
    if (topics.length === 0) {
      setError({ key: "agenda.topic.bulk.empty.error" });
      return;
    }
    setError(null);
    try {
      for (const topic of topics) {
        await addTopic.mutateAsync(topic);
      }
      setBulk("");
    } catch (mutationError) {
      setError(mutationErrorState(mutationError, "agenda.topic.bulk.error"));
    }
  }

  return (
    <Card className="flex flex-col p-4">
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <h2 className="text-sm font-bold text-foreground">{t("agenda.topic.heading")}</h2>
        {addTopic.isPending && <Badge tone="info">{t("agenda.topic.pending")}</Badge>}
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <section aria-labelledby="agenda-add-topic-label" className="space-y-2">
          {sectionLabel("agenda-add-topic-label", t("agenda.topic.form.eyebrow"))}
          <Input
            type="text"
            aria-label={t("agenda.topic.title.aria")}
            value={title}
            disabled={addTopic.isPending}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("agenda.topic.title.placeholder")}
          />
          <Input
            type="text"
            aria-label={t("agenda.topic.angle.aria")}
            value={angle}
            disabled={addTopic.isPending}
            onChange={(event) => setAngle(event.target.value)}
            placeholder={t("agenda.topic.angle.placeholder")}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">{t("agenda.topic.priority")}</span>
              <Select
                aria-label={t("agenda.topic.priority")}
                options={PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                value={priority}
                disabled={addTopic.isPending}
                onChange={(value: string) => setPriority(value)}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">{t("agenda.topic.responseLength")}</span>
              <Select
                aria-label={t("agenda.topic.responseLength")}
                options={RESPONSE_LENGTH_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                value={responseLength}
                disabled={addTopic.isPending}
                onChange={(value: string) => setResponseLength(value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">{t("agenda.topic.constraints.label")}</span>
            <Input
              type="text"
              aria-label={t("agenda.topic.constraints.aria")}
              value={constraintDraft}
              disabled={addTopic.isPending}
              onChange={(event) => setConstraintDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addConstraint(constraintDraft);
                }
              }}
              placeholder={t("agenda.topic.constraints.placeholder", { max: MAX_CONSTRAINTS })}
            />
            {constraints.length > 0 && (
              <ul aria-label={t("agenda.topic.constraints.list.aria")} className="flex flex-wrap gap-1.5">
                {constraints.map((constraint) => (
                  <li
                    key={constraint}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-foreground"
                  >
                    {constraint}
                    <button
                      type="button"
                      aria-label={t("agenda.topic.constraints.remove.aria", { tag: constraint })}
                      onClick={() => removeConstraint(constraint)}
                      className="text-dim transition-colors duration-fast ease-io hover:text-danger"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {constraintWarn && (
              <p className="text-xs text-warn">{t(constraintWarn, { n: MAX_CONSTRAINTS })}</p>
            )}
          </div>
        </section>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {"key" in error ? t(error.key) : error.text}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={addTopic.isPending}>
          {t("agenda.topic.submit.action")}
        </Button>

        <div className="flex items-center gap-2 py-1">
          <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
          <span className="text-xs text-dim">{t("agenda.topic.bulk.divider")}</span>
          <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
        </div>

        <section aria-labelledby="agenda-bulk-label" className="space-y-2">
          {sectionLabel("agenda-bulk-label", t("agenda.topic.bulk.eyebrow"))}
          <textarea
            aria-label={t("agenda.topic.bulk.aria")}
            value={bulk}
            disabled={addTopic.isPending}
            onChange={(event) => setBulk(event.target.value)}
            rows={4}
            placeholder={t("agenda.topic.bulk.placeholder")}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed min-h-[100px] max-h-[500px] disabled:opacity-60"
          />
          <Button type="button" variant="outline" disabled={addTopic.isPending} onClick={handleBulkSubmit}>
            {t("agenda.topic.bulk.submit.action")}
          </Button>
        </section>

        <div className="flex items-center gap-2 py-1">
          <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
          <span className="text-xs text-dim">{t("agenda.topic.templates.divider")}</span>
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
              aria-label={t("agenda.topic.templates.item.aria", { title: template.title })}
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

const SESSION_ACTIONS: Array<{ action: AgendaSessionAction; labelKey: TKey; variant: "primary" | "outline"; className?: string }> = [
  { action: "enable", labelKey: "agenda.sessionControl.action.enable", variant: "primary" },
  { action: "soft_stop", labelKey: "agenda.sessionControl.action.softStop", variant: "outline" },
  { action: "emergency_stop", labelKey: "agenda.sessionControl.action.emergencyStop", variant: "outline", className: "border-danger-bd text-danger hover:bg-danger-bg" }
];

/**
 * Session lifecycle — Activar/Pausa suave/Emergencia POST
 * /api/agenda/session/action with action=enable|soft_stop|emergency_stop
 * (whitelisted server-side against `_AGENDA_SESSION_ACTION_WHITELIST`,
 * opencohost/api/main.py). All three disable while any is pending; a
 * rejected action surfaces an alert instead of failing silently.
 */
function SessionControlCard({ state, queueLength }: { state: string; queueLength: number }) {
  const t = useT();
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
        <h2 className="text-sm font-bold text-foreground w-full">{t("agenda.sessionControl.title")}</h2>
        <div className="flex items-center gap-2">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {action.isPending && <Badge tone="info">{t("agenda.sessionControl.pending")}</Badge>}
        </div>
      </CollapsibleHeader>

      <CollapsibleBody isOpen={isOpen}>
      <div className="flex flex-col gap-3.5">
        {action.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t("agenda.sessionControl.action.error")}
          </p>
        )}

        {emptyQueue && (
          <p role="alert" className="text-xs leading-relaxed text-warn">
            {t("agenda.sessionControl.emptyQueue.warning")}
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
              {t(entry.labelKey)}
            </Button>
          ))}
        </div>
      </div>
      </CollapsibleBody>
    </Card>
  );
}

function TestToastsCard() {
  const t = useT();
  const { toast } = useToast();
  return (
    <Card className="flex flex-col p-4 gap-3">
      <h2 className="text-sm font-bold text-foreground">{t("agenda.testToasts.title")}</h2>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => toast(t("agenda.testToasts.success.message"), { tone: "ok" })}>{t("agenda.testToasts.success.action")}</Button>
        <Button onClick={() => toast(t("agenda.testToasts.error.message"), { tone: "danger" })}>{t("agenda.testToasts.error.action")}</Button>
        <Button onClick={() => toast(t("agenda.testToasts.warning.message"), { tone: "warn" })}>{t("agenda.testToasts.warning.action")}</Button>
        <Button onClick={() => toast(t("agenda.testToasts.info.message"), { tone: "info" })}>{t("agenda.testToasts.info.action")}</Button>
        <Button onClick={() => toast(t("agenda.testToasts.neutral.message"), { tone: "neutral" })}>{t("agenda.testToasts.neutral.action")}</Button>
      </div>
    </Card>
  );
}

type AgendaPane = "profile" | "topics";

const AGENDA_PANE_KEY = "oc-agenda-pane";

/**
 * Agenda panel — CTK parity (opencohost/ui/cohost_agenda_panel.py): profile
 * + session settings, Ahora (active topic), Cola (reorder/remove),
 * Sugerencias de Kira (approve/reject from drafted_topics), Agregar tema,
 * and Control de sesión (Activar/Pausa suave/Emergencia). See the
 * module-level note above for the exact backend routes each section uses.
 *
 * Two panes (PaneSwitcher, same pattern Memoria/Controles use): "Cohost
 * profile" (ProfileSessionCard — identity + the instant-apply session
 * settings) and "Topics" (Ahora/Cola/Agregar tema, plus Sugerencias).
 * SessionControlCard is deliberately NOT a pane — it's the live start/stop
 * control, so it renders unconditionally below the header, above whichever
 * pane is active (same principle as ConversationPanel in AppLayout.tsx: an
 * operational control the operator needs while streaming is never hidden
 * behind navigation). The GET-error alert is ALSO pane-independent, for the
 * same reason: a failed `GET /api/agenda` must be visible no matter which
 * pane the operator lands on, not just the Topics one — see JD-1.
 *
 * Both panes stay MOUNTED (hidden attribute, not `pane === … &&`) so
 * switching panes never destroys unsaved operator input — ProfileSessionCard's
 * styleDraft/draftName and AddTopicCard's title/angle/bulk/etc. would
 * otherwise be silently lost. This mirrors ControlsPanel.tsx, which restores
 * the exact mounting behaviour the deleted accordion (ControlGroup) used to
 * have; see that file for the general rationale, including why Memoria is the
 * deliberate exception that still unmounts.
 */
export function AgendaPanel() {
  const t = useT();
  const { data, isError: getError } = useAgendaQuery();

  const queue = data?.queued_topics ?? [];
  const suggestions = data?.drafted_topics ?? [];

  const options = [
    { value: "profile" as const, label: t("agenda.segment.cohostProfile") },
    { value: "topics" as const, label: t("agenda.segment.topics") }
  ];
  const { value: pane, switcher } = usePaneSwitcher<AgendaPane>(options, AGENDA_PANE_KEY, t("agenda.segment.aria"));

  return (
    <SettingsSection header={switcher}>
      {/* <TestToastsCard /> */}
      <SessionControlCard state={data?.state ?? data?.metrics.current_state ?? "OFF"} queueLength={queue.length} />

      {getError && (
        <Card className="flex flex-col p-4">
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t("agenda.load.error")}
          </p>
        </Card>
      )}

      <div
        data-testid="agenda-pane-profile"
        hidden={pane !== "profile"}
        style={pane !== "profile" ? { display: "none" } : undefined}
        className="flex flex-col gap-3.5"
      >
        <h2 className="text-sm font-bold text-foreground">{t("agenda.segment.cohostProfile")}</h2>
        <ProfileSessionCard />
      </div>

      <div
        data-testid="agenda-pane-topics"
        hidden={pane !== "topics"}
        style={pane !== "topics" ? { display: "none" } : undefined}
        className="flex flex-col gap-3.5"
      >
        <h2 className="text-sm font-bold text-foreground">{t("agenda.segment.topics")}</h2>
        {!getError && (
          <>
            <NowCard now={data?.active_topic} />
            <QueueCard queue={queue} />
            <AddTopicCard />
          </>
        )}
        <SuggestionsCard suggestions={suggestions} />
      </div>
    </SettingsSection>
  );
}
