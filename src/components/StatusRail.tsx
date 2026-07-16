import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Activity, AudioLines, Cpu, VenetianMask } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStatusQuery } from "../api/status.js";
import type { StatusResponse } from "../api/client.js";
import type { BadgeTone } from "./ui/Badge.js";
import { cn } from "../lib/cn.js";

// health.overall_status/*_status are untyped strings on the backend (no
// enum in openapi.snapshot.json). Real health_monitor.py emits
// green/yellow/red for overall_status; the MSW fixture uses "ok". Cover
// both vocabularies rather than hardcoding one.
const OK_VALUES = new Set(["ok", "green", "healthy", "running", "ready"]);
const WARN_VALUES = new Set(["yellow", "warn", "degraded", "low", "waiting", "unhealthy"]);
const DANGER_VALUES = new Set(["red", "critical", "down", "failed"]);

export function healthTone(status: string | undefined): BadgeTone {
  if (!status) return "neutral";
  if (OK_VALUES.has(status)) return "ok";
  if (WARN_VALUES.has(status)) return "warn";
  if (DANGER_VALUES.has(status)) return "danger";
  return "neutral";
}

// State taxonomy (spec §1). `action` is the ONLY state that fills the chip
// surface — the single mechanism that stops a working app from looking broken.
export type Taxonomy = "ok" | "info" | "attention" | "action" | "neutral";

// Escalation applied over the neutral chip base. ok/info/neutral keep the
// neutral surface; attention tints border+text; action gets the full filled
// danger treatment. (Chips no longer carry a tone dot — state reads from the
// icon + label + escalation surface. Per-row dots live only in the popover.)
const CHIP_ESCALATION: Record<Taxonomy, string> = {
  ok: "",
  info: "",
  neutral: "",
  attention: "border-warn-bd text-warn",
  action: "bg-danger-bg border-danger-bd text-danger"
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground opacity-50"
};

interface HealthInputs {
  overall_status: string;
  vram_status: string;
  rtf_status: string;
  ollama_status: string;
  qwen_status: string;
}

interface SistemaInputs {
  is_ready: boolean;
  ollama_warming?: boolean;
  health: HealthInputs;
}

export interface MotorRollup {
  taxonomy: Taxonomy;
  label: string;
  /** First popover line — WHY the state is what it is. */
  why: string;
  /** Second popover line — what to do (omitted for calm states). */
  todo?: string;
}

const DIM_NAMES: Array<[keyof HealthInputs, string]> = [
  ["vram_status", "VRAM"],
  ["rtf_status", "velocidad"],
  ["ollama_status", "Ollama"],
  ["qwen_status", "voz (Qwen)"]
];

// A dim is a "problem" (named in the Motor why-copy) when its healthTone is
// warn/danger OR its raw value is "unknown"/"unhealthy" — EXCEPT "unavailable",
// which is graceful degradation (pynvml or a service simply absent), never a
// fault. This mirrors the backend's own red condition for qwen
// (_compute_overall), so a red chip is always traceable to the dim that caused
// it instead of leaving the why-copy with empty parens.
function isDimProblem(value: string): boolean {
  if (value === "unavailable") return false;
  const tone = healthTone(value);
  return tone === "warn" || tone === "danger" || value === "unknown" || value === "unhealthy";
}

function degradedDims(health: HealthInputs): string {
  return DIM_NAMES.filter(([key]) => isDimProblem(health[key]))
    .map(([, name]) => name)
    .join(", ");
}

/**
 * Motor rollup (spec §3a, chip 1): collapses both the old `Sistema` and the
 * deleted `Health` chip into ONE instrument reading. Priority table (highest
 * wins) — `isError` (query failure) beats every health signal; the detail
 * table with real numbers now lives in the popover, not a second red chip.
 * Kept exported under this name so unit tests locate it.
 */
export function computeSistemaRollup(data: SistemaInputs | undefined, isError = false): MotorRollup {
  if (isError || !data) {
    return {
      taxonomy: "action",
      label: "Sin conexión",
      why: "No hay respuesta del motor local.",
      todo: "Revisá que OpenCohost esté corriendo y reintentá."
    };
  }

  const tone = healthTone(data.health.overall_status);
  const dims = degradedDims(data.health);

  if (tone === "danger") {
    return {
      taxonomy: "action",
      label: "Motor: necesita acción",
      why: dims ? `La salud del sistema está en rojo (${dims}).` : "La salud del sistema está en rojo.",
      todo: "Revisá el detalle abajo; si sigue en rojo, reiniciá el motor."
    };
  }
  if (tone === "warn") {
    return {
      taxonomy: "attention",
      label: "Motor: atención",
      why: dims
        ? `La salud está en amarillo (${dims}). Kira sigue funcionando.`
        : "La salud está en amarillo. Kira sigue funcionando.",
      todo: "Si pasa a rojo, bajá el tier del modelo desde Controles."
    };
  }
  if (!data.is_ready && data.ollama_warming) {
    return {
      taxonomy: "attention",
      label: "Motor: cargando modelo",
      why: "El modelo se está cargando en Ollama.",
      todo: "Suele tardar menos de un minuto — no hace falta hacer nada."
    };
  }
  if (!data.is_ready) {
    return {
      taxonomy: "attention",
      label: "Motor: preparando",
      why: "El motor todavía no está listo para responder.",
      todo: "Esperá unos segundos; si no arranca, revisá Ollama."
    };
  }
  if (tone === "neutral") {
    return {
      taxonomy: "neutral",
      label: "Motor: …",
      why: "Todavía no llegó el primer reporte de salud."
    };
  }
  return {
    taxonomy: "ok",
    label: "Motor OK",
    why: "Todo en orden: salud verde y modelo cargado."
  };
}

interface KiraState {
  taxonomy: Taxonomy;
  label: string;
  why: string;
  todo?: string;
}

// Chip 3 (spec §3a): merges the old `Voz` + `Inactivo` chips into one Kira
// activity readout, named from the operator's perspective.
function computeKira(data: StatusResponse): KiraState {
  if (data.is_speaking) {
    return { taxonomy: "info", label: "Kira: hablando", why: "Está reproduciendo su respuesta por voz." };
  }
  if (data.is_processing) {
    return { taxonomy: "info", label: "Kira: pensando…", why: "Está generando una respuesta." };
  }
  return {
    taxonomy: "neutral",
    label: "Kira: en espera",
    why: "Sin turnos nuevos — no es un error.",
    todo: "Escribile en el chat o mantené el micrófono para hablarle."
  };
}

interface DetailRow {
  label: string;
  value: string;
  tone: BadgeTone;
  mono?: boolean;
}

function PopoverDivider({ label }: { label: string }) {
  return (
    <div className="mb-1.5 mt-2.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-dim">
      <span>{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border-soft" />
    </div>
  );
}

interface StatusChipProps {
  icon: LucideIcon;
  taxonomy: Taxonomy;
  /** Visible chip label (may be truncating JSX). */
  label: ReactNode;
  /** Dialog aria-label + visible popover heading (plain text). */
  labelText: string;
  why: string;
  todo?: string;
  /** Motor only — the health detail table appended to its popover. */
  detail?: DetailRow[];
  /** Popover anchor edge. "right" anchors the popover to the chip's right edge
   * so a far-right chip (e.g. Perfil, pushed out by ml-auto) doesn't run its
   * popover off the viewport and get clipped. Default "left". */
  align?: "left" | "right";
  className?: string;
}

/**
 * One instrument chip: a button that toggles a why-popover. Keyboard-operable
 * (Enter/Space open via native button click; Escape and outside-click close —
 * same pattern as SettingsPopover). Only `action` fills the chip surface.
 */
function StatusChip({ icon: Icon, taxonomy, label, labelText, why, todo, detail, align = "left", className }: StatusChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const hasDetail = detail !== undefined && detail.length > 0;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        data-taxonomy={taxonomy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "mono inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors duration-fast ease-io",
          CHIP_ESCALATION[taxonomy]
        )}
      >
        <Icon size={13} aria-hidden="true" />
        {label}
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={labelText}
          className={cn(
            "absolute top-full z-50 mt-1.5 w-56 animate-rise-in rounded-md border border-border-soft bg-card p-3 text-left shadow-panel",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <p className="text-[13px] font-semibold text-foreground">{labelText}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{why}</p>

          {hasDetail && (
            <>
              <PopoverDivider label="detalle" />
              <ul className="flex flex-col gap-1">
                {detail.map((row) => (
                  <li key={row.label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">· {row.label}</span>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("text-dim", row.mono && "mono")}>{row.value}</span>
                      <span aria-hidden="true" className={cn("h-[6px] w-[6px] rounded-full", DOT_CLASSES[row.tone])} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {todo && (
            <>
              {hasDetail && <PopoverDivider label="qué hacer" />}
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{todo}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Status rail (spec §3a): a calm cockpit readout — four instrument chips
 * (Motor rollup, Modelo, Kira, Perfil) driven live by useStatusQuery. Color is
 * a verb: only `action` states fill a chip. On query error only the Motor chip
 * renders, in its `Sin conexión` action state (spec revision #5).
 */
export function StatusRail() {
  const { data, isLoading, isError } = useStatusQuery();

  if (isLoading || (!data && !isError)) {
    return (
      <div className="flex min-w-0 items-center px-2.5">
        <span className="mono inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground">
          Conectando con el motor…
        </span>
      </div>
    );
  }

  const motor = computeSistemaRollup(data, isError);
  const showAll = !isError && data !== undefined;

  const detail: DetailRow[] = showAll
    ? [
        {
          // "unavailable" = no pynvml / no GPU probe, NOT out-of-memory: 0 MB
          // would read as an OOM crisis, so name the real state instead.
          label: "VRAM libre",
          value: data.health.vram_status === "unavailable" ? "no disponible" : `${Math.round(data.health.free_vram_mb)} MB`,
          tone: healthTone(data.health.vram_status)
        },
        {
          // rtf_rolling_avg only populates after the first voice synthesis.
          label: "Velocidad",
          value: data.health.rtf_rolling_avg != null ? `RTF ${data.health.rtf_rolling_avg.toFixed(2)}` : "sin datos aún",
          tone: healthTone(data.health.rtf_status)
        },
        { label: "Ollama", value: data.health.ollama_status, tone: healthTone(data.health.ollama_status), mono: true },
        {
          // "unknown" is what holds overall_status red on the backend, so surface
          // it as "sin iniciar" with a danger dot — the red is then traceable to
          // its cause. Raw statuses stay mono; the prose fallback does not.
          label: "Qwen (voz)",
          value: data.health.qwen_status === "unknown" ? "sin iniciar" : data.health.qwen_status,
          tone:
            data.health.qwen_status === "unknown" || data.health.qwen_status === "unhealthy"
              ? "danger"
              : healthTone(data.health.qwen_status),
          mono: data.health.qwen_status !== "unknown"
        }
      ]
    : [];

  const kira = showAll ? computeKira(data) : null;

  return (
    <div
      role="status"
      aria-label="Estado operativo de OpenCohost"
      // Container is now bare: it lives inside the h-10 title bar, so the old
      // rounded/border/shadow/bg pill was dropped and the chips sit directly on
      // the bar. Kept flex/gap-2 (chip spacing) + px-2.5; dropped py-2 (it made
      // the group taller than the 40px bar — items-center centers the chips).
      className="flex min-w-0 items-center gap-2 px-2.5"
    >
      <StatusChip
        icon={Activity}
        taxonomy={motor.taxonomy}
        label={motor.label}
        labelText={motor.label}
        why={motor.why}
        todo={motor.todo}
        detail={detail}
      />

      {showAll && kira && (
        <>
          <StatusChip
            icon={Cpu}
            taxonomy="neutral"
            label={<span className="max-w-[190px] truncate">{data.current_model ?? "sin modelo"}</span>}
            labelText={data.current_model ?? "sin modelo"}
            why="Modelo activo en Ollama."
            todo="Lo cambiás desde Controles → Modelo."
          />
          <StatusChip
            icon={AudioLines}
            taxonomy={kira.taxonomy}
            label={kira.label}
            labelText={kira.label}
            why={kira.why}
            todo={kira.todo}
          />
          <StatusChip
            icon={VenetianMask}
            taxonomy="neutral"
            label={data.active_profile}
            labelText={data.active_profile}
            why="Personalidad activa de Kira."
            todo="La cambiás desde Perfiles en la barra lateral."
            align="right"
            className="ml-auto"
          />
        </>
      )}
    </div>
  );
}
