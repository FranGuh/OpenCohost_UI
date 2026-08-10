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

export interface Command {
  id: string;
  /** Mono badge shown in the list, e.g. "/agenda". */
  badge: string;
  /** Short title (entry heading). */
  title: string;
  /** One-line description shown beside the badge in the list. */
  description: string;
  steps?: StepDef[];
  summaryTitle?: string;
  /** Inert primary action label. A function form lets it reflect an answer
   * (e.g. /musica's "Poner canción" vs "Aplicar"). */
  primaryLabel?: string | ((values: Record<string, StepValue>) => string);
  /** Overrides the default "maquetado — todavía no envía" helper under the action. */
  actionNote?: string;
  /** Overrides the post-success "Cargar otro" re-arm label (Item 1) —
   * e.g. /agenda "Otro tema", /perfil "Otro perfil". */
  resetLabel?: string;
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
const PRIORITY_OPTIONS = PRIORITY_VOCAB.map(({ value, label }) => ({ value, label }));
const LENGTH_OPTIONS = LENGTH_VOCAB.map(({ value, label }) => ({ value, label }));
const SAFETY_OPTIONS = SAFETY_VOCAB.map(({ value, label }) => ({ value, label }));

const RHYTHM_OPTIONS = [
  { value: "calmo", label: "Calmo" },
  { value: "normal", label: "Normal" },
  { value: "dinamico", label: "Dinámico" }
] as const;

// ─── /temas — read-only agenda review screen ────────────────────────────────

// Badge tone/label derived from PRIORITY_VOCAB (F6) — same source as the
// /agenda priority Select above.
const PRIORITY_BADGE: Record<string, { tone: BadgeTone; label: string }> = Object.fromEntries(
  PRIORITY_VOCAB.map((entry) => [entry.value, { tone: entry.badgeTone, label: entry.label }])
);

/** Live `AgendaTopicOut.priority` is a free backend string (canonical
 * alta/normal/baja, but unknowns are possible). Map defensively — an unknown
 * priority falls to a neutral badge showing the raw value, never crashes. */
function priorityBadge(priority: string): { tone: BadgeTone; label: string } {
  return PRIORITY_BADGE[priority] ?? { tone: "neutral" as BadgeTone, label: priority };
}

function TemasScreen({ onClose }: { onClose: () => void }) {
  // WU1/R11: /temas reads the live agenda queue (GET /api/agenda) instead of
  // the old SAMPLE_TEMAS mock. Empty and unavailable states are explicit.
  const { data, isError } = useAgendaQuery();

  let body: ReactElement;
  if (isError) {
    body = (
      <p role="alert" className="text-[13px] text-danger">
        No se pudo leer la agenda — el motor no está disponible ahora.
      </p>
    );
  } else if (!data) {
    body = <p className="text-[13px] text-dim">Cargando agenda…</p>;
  } else if (data.queued_topics.length === 0) {
    body = <p className="text-[13px] text-dim">No hay temas en la cola de agenda.</p>;
  } else {
    body = (
      <ul aria-label="Temas en agenda" className="flex flex-col gap-2">
        {data.queued_topics.map((tema) => {
          const priority = priorityBadge(tema.priority);
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
          Cerrar
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
  if (state === "OFF") return { label: "Activar", action: "enable" };
  if (state && SESION_PAUSED_STATES.has(state)) return { label: "Reanudar", action: "enable" };
  return { label: "Pausar", action: "soft_stop" };
}

function SesionScreen({ onClose }: { onClose: () => void }) {
  // WU9/R27-R28: the four inert buttons collapse to one live-state-driven toggle
  // (Pausar/Reanudar/Activar) + the danger emergency stop, dispatched for real.
  // The label is derived from live agenda state, not local click history.
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
          No se pudo leer el estado de la sesión — el motor no está disponible ahora.
        </p>
      ) : !data ? (
        <p className="text-[13px] text-dim">Cargando estado de la sesión…</p>
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
            Parada de emergencia
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
          Cerrar
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
          setAck(`${describeMood(res)} · sonando ${picked.label}`);
        } else {
          setAck(`${describeMood(res)} · sin pista disponible para reproducir`);
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
          No se pudo leer la biblioteca de música — el motor no está disponible ahora.
        </p>
      ) : !data ? (
        <p className="text-[13px] text-dim">Cargando biblioteca…</p>
      ) : moods.length === 0 ? (
        <p className="text-[13px] text-dim">No hay moods disponibles en la biblioteca.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">Mood de la música</p>
          <Select
            aria-label="Mood de la música"
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
          Reproducir
        </Button>
        <Button type="button" variant="outline" className="flex-1" disabled={!playback.playing} onClick={() => playback.pause()}>
          Pausar
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={handleSiguiente}>
          Siguiente
        </Button>
      </div>

      {ack && (
        <p role="status" aria-live="polite" className="text-[13px] text-foreground">
          {ack}
        </p>
      )}
      <div className="mt-1 flex justify-end border-t border-border-soft pt-3">
        <Button type="button" variant="outline" className="h-8 px-3 text-[13px]" onClick={onClose}>
          Cerrar
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
    title: "programá un tema",
    description: "programá un tema para el stream",
    summaryTitle: "Tema listo para agendar",
    primaryLabel: "Programar tema",
    resetLabel: "Otro tema",
    // WU7/R12-R15: map the stepper values to the wire vocab, POST the topic, and
    // invalidate the agenda query so a reopened /temas reflects it (D6). Uses the
    // app-shared queryClient (main.tsx provides this same instance).
    submit: async (values) => {
      await postAgendaTopic(toAgendaTopicRequest(values));
      void queryClient.invalidateQueries({ queryKey: AGENDA_QUERY_KEY });
      return "Tema agregado a la cola.";
    },
    steps: [
      {
        kind: "text",
        id: "tema",
        question: "¿Qué tema querés agendar?",
        chipLabel: "tema",
        placeholder: "Tema claro, máximo 90 caracteres",
        maxLength: 90
      },
      {
        kind: "text",
        id: "angulo",
        question: "¿Cómo querés que Kira lo trate?",
        chipLabel: "ángulo",
        placeholder: "El ángulo o enfoque de Kira",
        multiline: true,
        optional: true
      },
      { kind: "select", id: "prioridad", question: "¿Qué prioridad tiene?", chipLabel: "prioridad", options: PRIORITY_OPTIONS, default: "normal" },
      { kind: "select", id: "largo", question: "¿Qué largo de respuesta?", chipLabel: "largo", options: LENGTH_OPTIONS, default: "normal" },
      { kind: "tags", id: "etiquetas", question: "Etiquetas (opcional)", chipLabel: "etiquetas", placeholder: "Enter para agregar" }
    ]
  },
  {
    id: "perfil",
    badge: "/perfil",
    // WU10/R18: copy explicitly names the COHOST profile (agenda identity), NOT
    // Kira's LLM persona — the old wording was ambiguous about which profile.
    title: "creá o cambiá un perfil de co-host",
    description: "guardá o cambiá el perfil de co-host de Kira — identidad y cómo suena en la agenda",
    summaryTitle: "Perfil de co-host listo para guardar",
    primaryLabel: "Guardar perfil de co-host",
    resetLabel: "Otro perfil",
    // WU10/R16-R19: save the cohost profile (identity) AND apply the session
    // fields — two calls, never POST /api/perfiles (the LLM persona). `estandar`
    // maps to `monologue` (R19 flagged), never sent raw.
    submit: async (values) => {
      await saveCohostProfile(toCohostProfileRequest(values));
      await putAgendaSession(toAgendaSessionRequest(values));
      return "Perfil de co-host guardado y sesión actualizada.";
    },
    steps: [
      {
        kind: "text",
        id: "nombre",
        question: "¿Cómo se llama el perfil?",
        chipLabel: "nombre",
        placeholder: "Nombre del perfil",
        section: { label: "Identidad" }
      },
      {
        kind: "text",
        id: "estilo",
        question: "Cómo suena Kira",
        chipLabel: "estilo",
        placeholder:
          "Soná como co-host natural de stream: cercana, con humor seco. Acompañá sin robar protagonismo…",
        multiline: true,
        optional: true,
        section: { label: "Identidad" }
      },
      {
        kind: "select",
        id: "turnos",
        question: "Intentos por tema",
        chipLabel: "intentos",
        options: AGENDA_TURN_OPTIONS,
        default: "5",
        section: { label: "Sesión", note: "se aplica al instante" }
      },
      {
        kind: "select",
        id: "modo",
        question: "Modo de seguridad en vivo",
        chipLabel: "modo",
        options: SAFETY_OPTIONS,
        default: "live_safe",
        section: { label: "Sesión", note: "se aplica al instante" }
      },
      {
        kind: "segmented",
        id: "ritmo",
        question: "Ritmo",
        chipLabel: "ritmo",
        options: RHYTHM_OPTIONS,
        default: "normal",
        section: { label: "Sesión", note: "se aplica al instante" }
      }
    ]
  },
  {
    id: "temas",
    badge: "/temas",
    title: "mirá qué hay en agenda",
    description: "mirá qué hay en agenda",
    screen: TemasScreen
  },
  {
    id: "vivo",
    badge: "/vivo",
    title: "conectá el chat en vivo",
    description: "conectá el chat en vivo",
    summaryTitle: "Listo para conectar",
    primaryLabel: "Conectar",
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
        question: "¿Qué plataforma?",
        chipLabel: "plataforma",
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
        question: "Link del video en vivo",
        chipLabel: "video",
        placeholder: "Pegá el link del video EN VIVO (watch?v=…)",
        when: (values) => values.plataforma !== "twitch"
      },
      {
        kind: "text",
        id: "canal",
        question: "Canal o URL de Twitch",
        chipLabel: "canal",
        placeholder: "Pegá el canal o la URL de Twitch",
        when: (values) => values.plataforma === "twitch"
      }
    ]
  },
  {
    id: "acciones",
    badge: "/acciones",
    title: "configurá cómo reacciona Kira",
    description: "configurá cómo reacciona Kira al chat",
    summaryTitle: "Acciones listas para aplicar",
    primaryLabel: "Aplicar acciones",
    // WU3/R26: same PUT whether or not the chat-live link is connected; only the
    // ack copy differs, read from the PUT response's own `connected` field
    // (R26b — never calls connect/disconnect).
    submit: async (values) => describeStreamLimits(await putStreamLimits(toStreamLimits(values))),
    steps: [
      {
        kind: "select",
        id: "reacciones",
        question: "Reaccionar si el chat supera",
        chipLabel: "reacciones",
        options: [
          { value: "bajo", label: "Bajo — 1 msg/s" },
          { value: "medio", label: "Medio — 3 msg/s" },
          { value: "alto", label: "Alto — 5 msg/s" }
        ],
        default: "medio",
        section: { label: "Reacciones" }
      },
      {
        kind: "select",
        id: "cooldown",
        question: "Esperar al menos entre reacciones",
        chipLabel: "cooldown",
        options: [
          { value: "bajo", label: "Bajo — 20 s" },
          { value: "medio", label: "Medio — 45 s" },
          { value: "alto", label: "Alto — 90 s" }
        ],
        default: "medio",
        section: { label: "Cooldown" }
      },
      {
        kind: "select",
        id: "spam",
        question: "Límite de mensajes repetidos",
        chipLabel: "spam",
        options: [
          { value: "5", label: "5 msgs/usuario en 30s" },
          { value: "10", label: "10 msgs/usuario en 30s" },
          { value: "20", label: "20 msgs/usuario en 30s" }
        ],
        default: "10",
        section: { label: "Spam" }
      },
      {
        kind: "select",
        id: "input_contract",
        question: "Contrato de entrada",
        chipLabel: "contrato",
        options: [
          { value: "balanced", label: "Equilibrado" },
          { value: "twitch_relaxed", label: "Relajado (Twitch)" },
          { value: "strict", label: "Estricto" }
        ],
        default: "balanced",
        section: { label: "Contrato de entrada" }
      }
    ]
  },
  {
    id: "sesion",
    badge: "/sesion",
    title: "controlá la sesión de agenda",
    description: "controlá la sesión de agenda",
    screen: SesionScreen
  },
  {
    id: "musica",
    badge: "/musica",
    // WU11/R29-R31: library/mood selection screen — free-text song search dropped.
    title: "controlá la música y el mood",
    description: "controlá la música y elegí un mood",
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
