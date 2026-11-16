import { Eye } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";
import { isVisionActivePhase, useVisionPhaseStore } from "../../store/visionStore.js";
import { useLookNow, useVisionQuery, visionReadiness } from "../../api/vision.js";

const BUTTON_CLASS = cn(
  "inline-flex h-7 items-center gap-1 rounded-md border border-border-soft px-2 text-xs font-semibold text-foreground transition-colors",
  "hover:bg-surface-2 disabled:opacity-50",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
);

/** Shared look-button state for the main chat and the desktop companion, so
 * both tell the same truth about readiness and arm the same one-shot look. */
export function useVisionLookControl() {
  const t = useT();
  const { data } = useVisionQuery();
  const look = useLookNow();

  const readiness = visionReadiness(data);
  const ready = data !== undefined && readiness === "ready";
  const armed = data?.status.armed ?? false;
  const phase = useVisionPhaseStore((s) => s.phase);
  const describing = phase === "describing";
  const looking = (data?.status.looking ?? false) || isVisionActivePhase(phase);
  const disabled = !ready || armed || looking || look.isPending;
  // The label tells the truth about why the control is unavailable; only a
  // ready service says "Look at this" (also the neutral label before the first
  // response, so the control does not flash "Vision off").
  const label =
    data === undefined || ready
      ? t("experiencia.vision.look")
      : readiness === "off"
        ? t("experiencia.vision.off")
        : readiness === "failed"
          ? t("experiencia.vision.unavailable")
          : t("experiencia.vision.warming");
  const title = readiness === "off" && data !== undefined ? t("experiencia.vision.look.disabled") : undefined;
  return { look, armed, looking, describing, disabled, label, title };
}

/**
 * "Look at this" one-shot trigger plus the visible "Kira is looking" indicator.
 * Both read GET /api/vision (polled faster while armed, looking or warming,
 * see useVisionQuery; `vision_looking` events patch the cache immediately, see
 * src/api/events.ts). Presentational copy only: nothing about the screenshot ever reaches the UI.
 */
export function VisionLookControl() {
  const t = useT();
  const { look, armed, looking, describing, disabled, label, title } = useVisionLookControl();

  return (
    <div className="mx-3 mb-2 flex flex-wrap items-center gap-2">
      <button type="button" className={BUTTON_CLASS} disabled={disabled} title={title} onClick={() => look.mutate()}>
        <Eye size={12} aria-hidden="true" />
        {label}
      </button>
      {looking ? (
        <span role="status" className="text-xs font-semibold text-foreground">
          {t(describing ? "experiencia.vision.describing" : "experiencia.vision.looking")}
        </span>
      ) : armed ? (
        <span role="status" className="text-xs text-muted-foreground">
          {t("experiencia.vision.look.armed")}
        </span>
      ) : null}
      {look.isError && (
        <span role="alert" className="text-xs font-semibold text-warn">
          {t("experiencia.vision.error")}
        </span>
      )}
    </div>
  );
}
