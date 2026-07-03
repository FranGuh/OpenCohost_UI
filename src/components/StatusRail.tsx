import { useStatusQuery } from "../api/status.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";

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

  return (
    <div className="flex flex-wrap items-center gap-[10px] rounded-xl border border-border-soft bg-card px-4 py-3 shadow-soft">
      <Badge tone={data.is_ready ? "ok" : "danger"}>{data.is_ready ? "Sistema: listo" : "Sistema: no listo"}</Badge>
      <Badge tone={data.current_model ? "info" : "neutral"} mono>
        Modelo: {data.current_model ?? "—"}
      </Badge>
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
