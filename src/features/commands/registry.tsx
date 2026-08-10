import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import {
  AGENDA_QUERY_KEY,
  AGENDA_TURN_OPTIONS,
  postAgendaTopic,
  putAgendaSession,
  saveCohostProfile,
  useAgendaQuery,
  useAgendaSessionActionMutation,
  type AgendaSessionAction
} from "../../api/agenda.js";
import {
  useMusicLibraryQuery,
  useMusicMoodMutation,
  type MusicMoodResponse
} from "../../api/music.js";
import { queryClient } from "../../api/queryClient.js";
import { ValidationError } from "../../api/client.js";
import { connectStreamAndAwait, putStreamLimits } from "../../api/stream.js";
import { pickRotationTrack } from "../musica/MusicPanel.js";
import { usePlaybackContext } from "../../state/PlaybackProvider.js";
import { t, useT, type TKey } from "../../i18n/t.js";
import { Badge } from "../../ui/Badge.js";
import type { BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Select } from "../../ui/Select.js";
import { type StepDef, type StepValue } from "./primitives.js";
import {
  LENGTH_VOCAB,
  PRIORITY_VOCAB,
  SAFETY_VOCAB,
  composeStreamUrl,
  describeConnect,
  isYoutubeChannelUrl,
  describeMood,
  describeSessionAction,
  describeStreamLimits,
  errorCopy,
  toAgendaSessionRequest,
  toAgendaTopicRequest,
  toCohostProfileRequest,
  toStreamLimits
} from "./wire.js";

/**
 * Command registry — MOCKUP ONLY. Each command is either a `steps` stepper
 * (driven by Stepper.tsx) or a custom `screen`. Adding a command is a data
 * edit here; the framework renders it. Nothing calls the network or mutates a
 * store — final actions are disabled or show a "maquetado" acknowledgement.
 */

/**
 * Copy note: `title`, `description`, `summaryTitle`, `primaryLabel` and the
 * steps' `question`/`chipLabel` stay typed as `string` and are resolved with
 * `t(...)` where this array is BUILT (module init). They cannot hold a `TKey`
 * because commands.test.tsx's `oneStepCommand` fixture assigns raw strings to
 * exactly those fields; typing them as keys would not compile without editing
 * that test. They therefore read in the boot locale and need a restart to
 * change. Every other copy field here holds a key and flips live.
 */
export interface Command {
  id: string;
  /** Mono badge shown in the list, e.g. "/agenda". */
  badge: string;
  /** Short title (entry heading). No renderer reads it today — the list shows
   * `id — description` — but it is kept, and translated, so a surface that
   * starts showing it does not reintroduce hardcoded Spanish. */
  title: string;
  /** One-line description shown beside the badge in the list. */
  description: string;
  steps?: StepDef[];
  summaryTitle?: string;
  /** Inert primary action label. A function form lets it reflect an answer
   * (e.g. /musica's "Poner canción" vs "Aplicar"). */
  primaryLabel?: string | ((values: Record<string, StepValue>) => string);
  /** Overrides the default "maquetado — todavía no envía" helper under the action. */
  actionNoteKey?: TKey;
  /** Overrides the post-success "Cargar otro" re-arm label (Item 1) —
   * e.g. /agenda "Otro tema", /perfil "Otro perfil". */
  resetLabelKey?: TKey;
  /**
   * D4 submit pipe: maps the stepper's collected values to a backend call and
   * resolves the ack text `ActionRow` renders on success. Absent → the command
   * keeps the inert "maquetado" ActionRow. Per-command implementations land in
   * their own WU (WU3/WU7-WU11).
   */
  submit?: (values: Record<string, StepValue>) => Promise<string>;
  /** Custom, non-stepper command surface (review/action screens). */
  screen?: (props: { onClose: () => void }) => ReactElement;
}

// ─── Shared option sets ─────────────────────────────────────────────────────

// Options derived from wire.ts's vocab descriptors (F6) — value/label live in
// ONE place per vocab; wire.ts's `*_WIRE` maps derive from the same array, so
// the UI options and the backend mapping can never drift apart.
const PRIORITY_OPTIONS = PRIORITY_VOCAB.map(({ value, labelKey }) => ({ value, labelKey }));
const LENGTH_OPTIONS = LENGTH_VOCAB.map(({ value, labelKey }) => ({ value, labelKey }));
const SAFETY_OPTIONS = SAFETY_VOCAB.map(({ value, labelKey }) => ({ value, labelKey }));

const RHYTHM_OPTIONS = [
  { value: "calmo", labelKey: "commands.vocab.rhythm.calmo" },
  { value: "normal", labelKey: "commands.vocab.rhythm.normal" },
  { value: "dinamico", labelKey: "commands.vocab.rhythm.dinamico" }
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;

// ─── /temas — read-only agenda review screen ────────────────────────────────

// Badge tone/label derived from PRIORITY_VOCAB (F6) — same source as the
// /agenda priority Select above.
const PRIORITY_BADGE: Record<string, { tone: BadgeTone; labelKey: TKey }> = Object.fromEntries(
  PRIORITY_VOCAB.map((entry) => [entry.value, { tone: entry.badgeTone, labelKey: entry.labelKey }])
);

/** Live `AgendaTopicOut.priority` is a free backend string (canonical
 * alta/normal/baja, but unknowns are possible). Map defensively — an unknown
 * priority falls to a neutral badge showing the raw value, never crashes. */
function priorityBadge(priority: string, translate: typeof t): { tone: BadgeTone; label: string } {
  const entry = PRIORITY_BADGE[priority];
  return entry ? { tone: entry.tone, label: translate(entry.labelKey) } : { tone: "neutral" as BadgeTone, label: priority };
}

function TemasScreen({ onClose }: { onClose: () => void }) {
  // WU1/R11: /temas reads the live agenda queue (GET /api/agenda) instead of
  // the old SAMPLE_TEMAS mock. Empty and unavailable states are explicit.
  const t = useT();
  const { data, isError } = useAgendaQuery();

  let body: ReactElement;
  if (isError) {
    body = (
      <p role="alert" className="text-[13px] text-danger">
        {t("commands.temas.load.error")}
      </p>
    );
  } else if (!data) {
    body = <p className="text-[13px] text-dim">{t("commands.temas.loading")}</p>;
  } else if (data.queued_topics.length === 0) {
    body = <p className="text-[13px] text-dim">{t("commands.temas.empty")}</p>;
  } else {
    body = (
      <ul aria-label={t("commands.temas.list.aria")} className="flex flex-col gap-2">
        {data.queued_topics.map((tema) => {
          const priority = priorityBadge(tema.priority, t);
          return (
            <li
              key={tema.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border-soft bg-surface-2 p-3"
            >
              <span className="text-[13px] font-semibold text-foreground">{tema.title}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge tone={priority.tone}>{priority.label}</Badge>
                <Badge tone="neutral">{tema.status}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {body}
      <div className="mt-1 flex justify-end border-t border-border-soft pt-3">
        <Button type="button" variant="outline" className="h-8 px-3 text-[13px]" onClick={onClose}>
          {t("commands.temas.close.action")}
        </Button>
      </div>
    </div>
  );
}

// ─── /sesion — live session controls screen ─────────────────────────────────

/** Backend session states that read as "paused, pending resume"
 * (kira_agenda_controller.py `AgendaState`). A paused or OFF session resumes/
 * starts with the same `enable` verb; a running one pauses with `soft_stop`
 * (R27), so the two collapse into ONE state-driven toggle. */
const SESION_PAUSED_STATES = new Set(["PAUSED", "PAUSED_NEEDS_OPERATOR", "HARD_PAUSED"]);

function sessionToggle(state: string | undefined): { label: string; action: AgendaSessionAction } {
  if (state === "OFF") return { label: t("commands.sesion.toggle.activate"), action: "enable" };
  if (state && SESION_PAUSED_STATES.has(state)) return { label: t("commands.sesion.toggle.resume"), action: "enable" };
  return { label: t("commands.sesion.toggle.pause"), action: "soft_stop" };
}

function SesionScreen({ onClose }: { onClose: () => void }) {
  // WU9/R27-R28: the four inert buttons collapse to one live-state-driven toggle
  // (Pausar/Reanudar/Activar) + the danger emergency stop, dispatched for real.
  // The label is derived from live agenda state, not local click history.
  const t = useT();
  const { data, isError } = useAgendaQuery();
  const mutation = useAgendaSessionActionMutation();
  const [ack, setAck] = useState<string | null>(null);

  const dispatch = (action: AgendaSessionAction) => {
    setAck(null);
    mutation.mutate(
      { action },
      {
        onSuccess: (res) => setAck(describeSessionAction(action, res)),
        onError: (err) => setAck(errorCopy(err))
      }
    );
  };

  const toggle = sessionToggle(data?.state);
  const busy = mutation.isPending;

  return (
    <div className="flex flex-col gap-3">
      {isError ? (
        <p role="alert" className="text-[13px] text-danger">
          {t("commands.sesion.load.error")}
        </p>
      ) : !data ? (
        <p className="text-[13px] text-dim">{t("commands.sesion.loading")}</p>
      ) : (
        <div className="space-y-2">
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => dispatch(toggle.action)}>
            {toggle.label}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="w-full border-transparent bg-danger text-white hover:opacity-90"
            disabled={busy}
            onClick={() => dispatch("emergency_stop")}
          >
            {t("commands.sesion.emergencyStop.action")}
          </Button>
        </div>
      )}
      {ack && (
        <p role="status" aria-live="polite" className="text-[13px] text-foreground">
          {ack}
        </p>
      )}
      <div className="mt-1 flex justify-end border-t border-border-soft pt-3">
        <Button type="button" variant="outline" className="h-8 px-3 text-[13px]" onClick={onClose}>
          {t("commands.sesion.close.action")}
        </Button>
      </div>
    </div>
  );
}

// ─── /musica — live mood selection + playback screen ─────────────────────────

function MusicaScreen({ onClose }: { onClose: () => void }) {
  // WU11/R29-R31 selection + Lote B playback: the mood submit and the transport
  // buttons drive the SAME client-side <audio> element MusicPanel uses, via the
  // shared PlaybackProvider ("the API orchestrates, the client plays" — 2911).
  const t = useT();
  const { data, isError } = useMusicLibraryQuery();
  const mutation = useMusicMoodMutation();
  const playback = usePlaybackContext();
  const [ack, setAck] = useState<string | null>(null);
  const [mood, setMood] = useState<string>("");
  // Last mood response, so "Siguiente"/"Reproducir" can rotate over the same
  // bucket the operator last selected instead of always the raw library.
  const [lastResult, setLastResult] = useState<MusicMoodResponse | null>(null);

  const moods = data?.moods ?? [];
  const tracks = data?.tracks ?? [];
  // Default the selector to the first live mood once the library loads. This
  // only seeds the control — it never auto-dispatches a mood.
  useEffect(() => {
    if (!mood && moods.length > 0) setMood(moods[0]);
  }, [mood, moods]);

  // Reuses MusicPanel's exact rotation logic. Falls back to a synthetic empty
  // result (→ rotate the valid library) when no mood has been submitted yet, so
  // the transport buttons work before any mood click. Returns the picked track
  // AND its display label, or null when nothing is playable.
  function pickTrack(result: MusicMoodResponse | null): { id: string; label: string } | null {
    const source: MusicMoodResponse = result ?? { active_mood: mood, tracks: [], suggested_track_id: null };
    const id = pickRotationTrack(source, playback.currentTrackId, tracks);
    if (!id) return null;
    const label = [...source.tracks, ...tracks].find((track) => track.id === id)?.label ?? id;
    return { id, label };
  }

  const applyMood = (next: string) => {
    setMood(next);
    setAck(null);
    mutation.mutate(next, {
      onSuccess: (res) => {
        setLastResult(res);
        const picked = pickTrack(res);
        if (picked) {
          playback.playTrack(picked.id, picked.label);
          setAck(`${describeMood(res)} · ${t("commands.musica.ack.playing", { track: picked.label })}`);
        } else {
          setAck(`${describeMood(res)} · ${t("commands.musica.ack.noTrack")}`);
        }
      },
      onError: (err) => setAck(errorCopy(err))
    });
  };

  const handleReproducir = () => {
    // A loaded-but-paused track resumes; otherwise pick a rotation track (from
    // the last mood, or the library) and start it. Already playing → no-op.
    if (playback.currentTrackId && !playback.playing) {
      playback.toggle();
      return;
    }
    if (playback.playing) return;
    const picked = pickTrack(lastResult);
    if (picked) playback.playTrack(picked.id, picked.label);
  };

  const handleSiguiente = () => {
    const picked = pickTrack(lastResult);
    if (picked) playback.playTrack(picked.id, picked.label);
  };

  return (
    <div className="flex flex-col gap-3">
      {isError ? (
        <p role="alert" className="text-[13px] text-danger">
          {t("commands.musica.load.error")}
        </p>
      ) : !data ? (
        <p className="text-[13px] text-dim">{t("commands.musica.loading")}</p>
      ) : moods.length === 0 ? (
        <p className="text-[13px] text-dim">{t("commands.musica.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">{t("commands.musica.moodLabel")}</p>
          <Select
            aria-label={t("commands.musica.moodLabel")}
            options={moods.map((name) => ({ value: name, label: name }))}
            value={mood}
            onChange={applyMood}
          />
        </div>
      )}

      {/* Transport controls — drive the shared PlaybackProvider (Lote B). No
          network call: playback is client-side. Pausar disables when idle. */}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={handleReproducir}>
          {t("commands.musica.transport.play.action")}
        </Button>
        <Button type="button" variant="outline" className="flex-1" disabled={!playback.playing} onClick={() => playback.pause()}>
          {t("commands.musica.transport.pause.action")}
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={handleSiguiente}>
          {t("commands.musica.transport.next.action")}
        </Button>
      </div>

      {ack && (
        <p role="status" aria-live="polite" className="text-[13px] text-foreground">
          {ack}
        </p>
      )}
      <div className="mt-1 flex justify-end border-t border-border-soft pt-3">
        <Button type="button" variant="outline" className="h-8 px-3 text-[13px]" onClick={onClose}>
          {t("commands.musica.close.action")}
        </Button>
      </div>
    </div>
  );
}

// ─── The seven commands ─────────────────────────────────────────────────────

export const COMMANDS: Command[] = [
  {
    id: "agenda",
    badge: "/agenda",
    title: t("commands.agenda.title"),
    description: t("commands.agenda.description"),
    summaryTitle: t("commands.agenda.summaryTitle"),
    primaryLabel: t("commands.agenda.primary.action"),
    resetLabelKey: "commands.agenda.reset.action",
    // WU7/R12-R15: map the stepper values to the wire vocab, POST the topic, and
    // invalidate the agenda query so a reopened /temas reflects it (D6). Uses the
    // app-shared queryClient (main.tsx provides this same instance).
    submit: async (values) => {
      await postAgendaTopic(toAgendaTopicRequest(values));
      void queryClient.invalidateQueries({ queryKey: AGENDA_QUERY_KEY });
      return t("commands.agenda.submit.ack");
    },
    steps: [
      {
        kind: "text",
        id: "tema",
        question: t("commands.agenda.step.tema.question"),
        chipLabel: t("commands.agenda.step.tema.chip"),
        placeholderKey: "commands.agenda.step.tema.placeholder",
        maxLength: 90
      },
      {
        kind: "text",
        id: "angulo",
        question: t("commands.agenda.step.angulo.question"),
        chipLabel: t("commands.agenda.step.angulo.chip"),
        placeholderKey: "commands.agenda.step.angulo.placeholder",
        multiline: true,
        optional: true
      },
      { kind: "select", id: "prioridad", question: t("commands.agenda.step.prioridad.question"), chipLabel: t("commands.agenda.step.prioridad.chip"), options: PRIORITY_OPTIONS, default: "normal" },
      { kind: "select", id: "largo", question: t("commands.agenda.step.largo.question"), chipLabel: t("commands.agenda.step.largo.chip"), options: LENGTH_OPTIONS, default: "normal" },
      // No placeholderKey: TagsStep already defaults to the shared
      // "Enter para agregar" key, which is byte-identical to the old literal.
      { kind: "tags", id: "etiquetas", question: t("commands.agenda.step.etiquetas.question"), chipLabel: t("commands.agenda.step.etiquetas.chip") }
    ]
  },
  {
    id: "perfil",
    badge: "/perfil",
    // WU10/R18: copy explicitly names the COHOST profile (agenda identity), NOT
    // Kira's LLM persona — the old wording was ambiguous about which profile.
    title: t("commands.perfil.title"),
    description: t("commands.perfil.description"),
    summaryTitle: t("commands.perfil.summaryTitle"),
    primaryLabel: t("commands.perfil.primary.action"),
    resetLabelKey: "commands.perfil.reset.action",
    // WU10/R16-R19: save the cohost profile (identity) AND apply the session
    // fields — two calls, never POST /api/perfiles (the LLM persona). `estandar`
    // maps to `monologue` (R19 flagged), never sent raw.
    submit: async (values) => {
      await saveCohostProfile(toCohostProfileRequest(values));
      await putAgendaSession(toAgendaSessionRequest(values));
      return t("commands.perfil.submit.ack");
    },
    steps: [
      {
        kind: "text",
        id: "nombre",
        question: t("commands.perfil.step.nombre.question"),
        chipLabel: t("commands.perfil.step.nombre.chip"),
        placeholderKey: "commands.perfil.step.nombre.placeholder",
        section: { labelKey: "commands.perfil.section.identidad.label" }
      },
      {
        kind: "text",
        id: "estilo",
        question: t("commands.perfil.step.estilo.question"),
        chipLabel: t("commands.perfil.step.estilo.chip"),
        placeholderKey: "commands.perfil.step.estilo.placeholder",
        multiline: true,
        optional: true,
        section: { labelKey: "commands.perfil.section.identidad.label" }
      },
      {
        kind: "select",
        id: "turnos",
        question: t("commands.perfil.step.turnos.question"),
        chipLabel: t("commands.perfil.step.turnos.chip"),
        options: AGENDA_TURN_OPTIONS,
        default: "5",
        section: { labelKey: "commands.perfil.section.sesion.label", noteKey: "commands.perfil.section.sesion.note" }
      },
      {
        kind: "select",
        id: "modo",
        question: t("commands.perfil.step.modo.question"),
        chipLabel: t("commands.perfil.step.modo.chip"),
        options: SAFETY_OPTIONS,
        default: "live_safe",
        section: { labelKey: "commands.perfil.section.sesion.label", noteKey: "commands.perfil.section.sesion.note" }
      },
      {
        kind: "segmented",
        id: "ritmo",
        question: t("commands.perfil.step.ritmo.question"),
        chipLabel: t("commands.perfil.step.ritmo.chip"),
        options: RHYTHM_OPTIONS,
        default: "normal",
        section: { labelKey: "commands.perfil.section.sesion.label", noteKey: "commands.perfil.section.sesion.note" }
      }
    ]
  },
  {
    id: "temas",
    badge: "/temas",
    title: t("commands.temas.title"),
    description: t("commands.temas.description"),
    screen: TemasScreen
  },
  {
    id: "vivo",
    badge: "/vivo",
    title: t("commands.vivo.title"),
    description: t("commands.vivo.description"),
    summaryTitle: t("commands.vivo.summaryTitle"),
    primaryLabel: t("commands.vivo.primary.action"),
    // WU8/R20-R21 + Lote C: compose a single url (plataforma is UI-only). Reject
    // a YouTube channel URL client-side (it can only 422), then connect and POLL
    // status until connected — the raw POST returns connected:false a beat early
    // because the backend connects on a daemon thread. Timeout / 422 / 409 / 503
    // all throw and are surfaced by errorCopy.
    submit: async (values) => {
      const plataforma = values.plataforma as string;
      const canal = values.canal as string;
      if (isYoutubeChannelUrl(canal)) {
        throw new ValidationError("youtube_channel_url");
      }
      return describeConnect(await connectStreamAndAwait(composeStreamUrl(plataforma, canal)));
    },
    steps: [
      {
        kind: "select",
        id: "plataforma",
        question: t("commands.vivo.step.plataforma.question"),
        chipLabel: t("commands.vivo.step.plataforma.chip"),
        // Proper nouns — the same in every locale, so they stay literal.
        options: [
          { value: "youtube", label: "YouTube" },
          { value: "twitch", label: "Twitch" }
        ],
        default: "youtube"
      },
      // Per-platform URL copy (Lote C): mutually-exclusive `when` gates render
      // exactly one `canal` step. YouTube needs the live VIDEO link (a channel
      // URL 422s); Twitch takes a channel name or URL.
      {
        kind: "text",
        id: "canal",
        question: t("commands.vivo.step.canal.youtube.question"),
        chipLabel: t("commands.vivo.step.canal.youtube.chip"),
        placeholderKey: "commands.vivo.step.canal.youtube.placeholder",
        when: (values) => values.plataforma !== "twitch"
      },
      {
        kind: "text",
        id: "canal",
        question: t("commands.vivo.step.canal.twitch.question"),
        chipLabel: t("commands.vivo.step.canal.twitch.chip"),
        placeholderKey: "commands.vivo.step.canal.twitch.placeholder",
        when: (values) => values.plataforma === "twitch"
      }
    ]
  },
  {
    id: "acciones",
    badge: "/acciones",
    title: t("commands.acciones.title"),
    description: t("commands.acciones.description"),
    summaryTitle: t("commands.acciones.summaryTitle"),
    primaryLabel: t("commands.acciones.primary.action"),
    // WU3/R26: same PUT whether or not the chat-live link is connected; only the
    // ack copy differs, read from the PUT response's own `connected` field
    // (R26b — never calls connect/disconnect).
    submit: async (values) => describeStreamLimits(await putStreamLimits(toStreamLimits(values))),
    steps: [
      {
        kind: "select",
        id: "reacciones",
        question: t("commands.acciones.step.reacciones.question"),
        chipLabel: t("commands.acciones.step.reacciones.chip"),
        options: [
          { value: "bajo", labelKey: "commands.acciones.option.reacciones.bajo" },
          { value: "medio", labelKey: "commands.acciones.option.reacciones.medio" },
          { value: "alto", labelKey: "commands.acciones.option.reacciones.alto" }
        ],
        default: "medio",
        section: { labelKey: "commands.acciones.section.reacciones.label" }
      },
      {
        kind: "select",
        id: "cooldown",
        question: t("commands.acciones.step.cooldown.question"),
        chipLabel: t("commands.acciones.step.cooldown.chip"),
        options: [
          { value: "bajo", labelKey: "commands.acciones.option.cooldown.bajo" },
          { value: "medio", labelKey: "commands.acciones.option.cooldown.medio" },
          { value: "alto", labelKey: "commands.acciones.option.cooldown.alto" }
        ],
        default: "medio",
        section: { labelKey: "commands.acciones.section.cooldown.label" }
      },
      {
        kind: "select",
        id: "spam",
        question: t("commands.acciones.step.spam.question"),
        chipLabel: t("commands.acciones.step.spam.chip"),
        options: [
          { value: "5", labelKey: "commands.acciones.option.spam.5" },
          { value: "10", labelKey: "commands.acciones.option.spam.10" },
          { value: "20", labelKey: "commands.acciones.option.spam.20" }
        ],
        default: "10",
        section: { labelKey: "commands.acciones.section.spam.label" }
      },
      {
        kind: "select",
        id: "input_contract",
        question: t("commands.acciones.step.input_contract.question"),
        chipLabel: t("commands.acciones.step.input_contract.chip"),
        options: [
          { value: "balanced", labelKey: "commands.acciones.option.input_contract.balanced" },
          { value: "twitch_relaxed", labelKey: "commands.acciones.option.input_contract.twitch_relaxed" },
          { value: "strict", labelKey: "commands.acciones.option.input_contract.strict" }
        ],
        default: "balanced",
        section: { labelKey: "commands.acciones.section.input_contract.label" }
      }
    ]
  },
  {
    id: "sesion",
    badge: "/sesion",
    title: t("commands.sesion.title"),
    description: t("commands.sesion.description"),
    screen: SesionScreen
  },
  {
    id: "musica",
    badge: "/musica",
    // WU11/R29-R31: library/mood selection screen — free-text song search dropped.
    title: t("commands.musica.title"),
    description: t("commands.musica.description"),
    screen: MusicaScreen
  }
];

/** Strip the leading "/" or "!" and normalize, for command-name matching. */
export function commandFilter(query: string): string {
  return query.trim().replace(/^[/!]/, "").trim().toLowerCase();
}

export function matchCommands(query: string): Command[] {
  const filter = commandFilter(query);
  return COMMANDS.filter((command) => command.id.startsWith(filter));
}
