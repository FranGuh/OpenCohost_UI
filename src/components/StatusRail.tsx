import { useStatusQuery } from "../api/status.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";
import { cn } from "../lib/cn.js";

// Signature ring/aperture motif (echoes BrandMark's ring) — a small partial
// ring next to the Sistema rollup, tinted to the same tone as its Badge.
const RING_TONE_CLASS: Record<BadgeTone, string> = {
  ok: "border-ok",
  warn: "border-warn",
  danger: "border-danger",
  info: "border-info",
  neutral: "border-muted-foreground"
};

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

interface SistemaInputs {
  is_ready: boolean;
  is_speaking: boolean;
  is_processing: boolean;
  health: { overall_status: string };
}

/**
 * Sistema rollup (CTk parity — opencohost/ui/status_bar.py::_recompute_rollup):
 * collapses per-dimension health into ONE worst-status pill naming the
 * degraded dimension. Only inputs already on GET /api/status are used
 * (is_ready, is_speaking, is_processing, health.overall_status). `ollama_warming`
 * is surfaced separately as its own badge below (not folded into the rollup) —
 * it's an expected transient state during cold start, not a degradation.
 *
 * Priority (highest wins), mirroring the CTk CRIT/WARN/INFO/QUIET/OK table:
 *   CRIT  — health.overall_status is a danger value       -> "salud"
 *   WARN  — health.overall_status is a warn value          -> "salud"
 *         — !is_ready                                      -> "modelo"
 *   INFO  — is_speaking || is_processing (no crit/warn)
 *   QUIET — health.overall_status unknown/unrecognized (no crit/warn/info)
 *   OK    — all nominal
 */
export function computeSistemaRollup(data: SistemaInputs): { label: string; tone: BadgeTone } {
  const tone = healthTone(data.health.overall_status);

  const crit: string[] = tone === "danger" ? ["salud"] : [];
  const warn: string[] = [
    ...(tone === "warn" ? ["salud"] : []),
    ...(!data.is_ready ? ["modelo"] : [])
  ];

  if (crit.length > 0) {
    return { label: `Sistema: error · ${crit.join(", ")}`, tone: "danger" };
  }
  if (warn.length > 0) {
    return { label: `Sistema: alerta · ${warn.join(", ")}`, tone: "warn" };
  }
  if (data.is_speaking || data.is_processing) {
    return { label: "Sistema: activo", tone: "info" };
  }
  if (tone === "neutral") {
    return { label: "Sistema: ...", tone: "neutral" };
  }
  return { label: "Sistema: OK", tone: "ok" };
}

/**
 * Status rail (spec R2): semantic Badges driven live by useStatusQuery.
 * Maps the REAL StatusResponse fields (is_ready/current_model/health/
 * is_speaking/is_processing/active_profile) to tones — no mic/chat
 * placeholders, the API doesn't expose those signals in P1.
 */
export function StatusRail() {
  const { data, isLoading, isError } = useStatusQuery();

  if (isLoading || !data) {
    return (
      <div className="flex h-[52px] items-center gap-2 rounded-xl border border-border-soft bg-card px-4 text-sm text-muted-foreground shadow-soft">
        Cargando estado del motor…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-[52px] items-center gap-2 rounded-xl border border-border-soft bg-card px-4 shadow-soft">
        <Badge tone="danger">Estado: sin conexión</Badge>
      </div>
    );
  }

  const sistema = computeSistemaRollup(data);

  return (
    <div className="flex flex-wrap items-center gap-[10px] rounded-xl border border-border-soft bg-card px-4 py-3 shadow-soft">
      <span
        aria-hidden="true"
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full border-2 border-t-transparent", RING_TONE_CLASS[sistema.tone])}
      />
      <Badge tone={sistema.tone}>{sistema.label}</Badge>
      <Badge tone={data.current_model ? "info" : "neutral"} mono>
        Modelo: {data.current_model ?? "—"}
      </Badge>
      {data.ollama_warming && !data.is_ready && <Badge tone="warn">Modelo: calentando…</Badge>}
      <Badge tone={healthTone(data.health.overall_status)}>Health: {data.health.overall_status}</Badge>
      <Badge tone={data.is_speaking ? "info" : "neutral"}>
        {data.is_speaking ? "Voz: hablando" : "Voz: en silencio"}
      </Badge>
      <Badge tone={data.is_processing ? "warn" : "neutral"}>{data.is_processing ? "Procesando…" : "Inactivo"}</Badge>
      <Badge tone="neutral" mono className="ml-auto">
        Perfil: {data.active_profile}
      </Badge>
    </div>
  );
}
