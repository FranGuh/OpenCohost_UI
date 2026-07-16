import { useState } from "react";
import type { ReactElement } from "react";
import { Badge } from "../ui/Badge.js";
import type { BadgeTone } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { InfoNote, type StepDef, type StepValue } from "./primitives.js";

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
  /** Custom, non-stepper command surface (review/action screens). */
  screen?: (props: { onClose: () => void }) => ReactElement;
}

// ─── Shared option sets ─────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { value: "baja", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "alta", label: "Alta" }
] as const;

const LENGTH_OPTIONS = [
  { value: "corto", label: "Corto" },
  { value: "normal", label: "Normal" },
  { value: "extendido", label: "Extendido" }
] as const;

const TURN_OPTIONS = [
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "8", label: "8" }
] as const;

const SAFETY_OPTIONS = [
  { value: "live_safe", label: "Live-safe" },
  { value: "estandar", label: "Estándar" }
] as const;

const RHYTHM_OPTIONS = [
  { value: "calmo", label: "Calmo" },
  { value: "normal", label: "Normal" },
  { value: "dinamico", label: "Dinámico" }
] as const;

// ─── /temas — read-only agenda review screen ────────────────────────────────

const SAMPLE_TEMAS: { title: string; priority: keyof typeof PRIORITY_BADGE; estado: keyof typeof ESTADO_BADGE }[] = [
  { title: "Nostalgia de los 2000 en gaming", priority: "normal", estado: "al aire" },
  { title: "Burnout de streamers", priority: "alta", estado: "pendiente" },
  { title: "Mods como cultura popular", priority: "baja", estado: "hecho" }
];

const PRIORITY_BADGE = {
  alta: { tone: "warn" as BadgeTone, label: "Alta" },
  normal: { tone: "info" as BadgeTone, label: "Normal" },
  baja: { tone: "ok" as BadgeTone, label: "Baja" }
};

const ESTADO_BADGE = {
  "al aire": { tone: "ok" as BadgeTone, label: "al aire" },
  pendiente: { tone: "info" as BadgeTone, label: "pendiente" },
  hecho: { tone: "neutral" as BadgeTone, label: "hecho" }
};

function TemasScreen({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Temas en agenda" className="flex flex-col gap-2">
        {SAMPLE_TEMAS.map((tema) => {
          const priority = PRIORITY_BADGE[tema.priority];
          const estado = ESTADO_BADGE[tema.estado];
          return (
            <li
              key={tema.title}
              className="flex items-center justify-between gap-3 rounded-md border border-border-soft bg-surface-2 p-3"
            >
              <span className="text-[13px] font-semibold text-foreground">{tema.title}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge tone={priority.tone}>{priority.label}</Badge>
                <Badge tone={estado.tone}>{estado.label}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
      <InfoNote>maquetado — va a leer la agenda real</InfoNote>
      <div className="mt-1 flex justify-end border-t border-border-soft pt-3">
        <Button type="button" variant="outline" className="h-8 px-3 text-[13px]" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}

// ─── /sesion — inert session controls screen ────────────────────────────────

const SESION_ACTIONS = [
  { id: "pausar", label: "Pausar", danger: false },
  { id: "activar", label: "Activar", danger: false },
  { id: "reanudar", label: "Reanudar", danger: false },
  { id: "emergencia", label: "Parada de emergencia", danger: true }
] as const;

function SesionScreen({ onClose }: { onClose: () => void }) {
  // Clicking any control is inert — it only echoes a quiet "no effect yet" line.
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <InfoNote>
        Cada botón todavía no hace nada — Pausar, Activar, Reanudar y la parada de emergencia son una maqueta de la sesión de
        agenda.
      </InfoNote>
      <div className="space-y-2">
        {SESION_ACTIONS.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant={action.danger ? "primary" : "outline"}
            className={`w-full ${action.danger ? "border-transparent bg-danger text-white hover:opacity-90" : ""}`}
            onClick={() => setAcknowledged(true)}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {acknowledged && (
        <p role="status" aria-live="polite" className="text-[11px] text-dim">
          maquetado — sin efecto todavía
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
    title: "creá o ajustá un perfil",
    description: "creá o ajustá un perfil de Kira",
    summaryTitle: "Perfil listo para guardar",
    primaryLabel: "Guardar perfil",
    actionNote: "Guarda el nombre y el estilo como un perfil reutilizable.",
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
        question: "Turnos por tema",
        chipLabel: "turnos",
        options: TURN_OPTIONS,
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
    actionNote: "maquetado — todavía no conecta",
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
      { kind: "text", id: "canal", question: "Canal o URL", chipLabel: "canal", placeholder: "Pegá el canal o la URL del stream" }
    ]
  },
  {
    id: "acciones",
    badge: "/acciones",
    title: "configurá cómo reacciona Kira",
    description: "configurá cómo reacciona Kira al chat",
    summaryTitle: "Acciones listas para aplicar",
    primaryLabel: "Aplicar acciones",
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
        kind: "switch",
        id: "input_contract",
        question: "Contrato de entrada",
        chipLabel: "contrato",
        switchLabel: "Input Contract (contexto real)",
        note: "El endpoint ya acepta filter_policy — falta decidir qué preset corresponde a este switch.",
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
    title: "controlá la música o poné una canción",
    description: "controlá la música o poné una canción",
    summaryTitle: "Música lista",
    // "Poner una canción" is a create action → "Poner canción"; the transport
    // options (reproducir/pausar/siguiente) share the generic "Aplicar".
    primaryLabel: (values) => (values.accion === "poner" ? "Poner canción" : "Aplicar"),
    actionNote: "maquetado — todavía no controla la música",
    steps: [
      {
        kind: "select",
        id: "accion",
        question: "¿Qué querés hacer?",
        chipLabel: "acción",
        options: [
          { value: "reproducir", label: "Reproducir" },
          { value: "pausar", label: "Pausar" },
          { value: "siguiente", label: "Siguiente" },
          { value: "poner", label: "Poner una canción" }
        ],
        default: "reproducir"
      },
      {
        kind: "text",
        id: "cancion",
        question: "¿Qué canción?",
        chipLabel: "canción",
        placeholder: "nombre o artista",
        maxLength: 120,
        // Conditional step: only asked when "Poner una canción" is chosen.
        when: (values) => values.accion === "poner"
      }
    ]
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
