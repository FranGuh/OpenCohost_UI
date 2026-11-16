import { visionReasonKey, type VisionComposerState } from "../../api/vision.js";
import { useT } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";

const LABEL = {
  starting: "experiencia.vision.indicator.starting",
  ready: "experiencia.vision.indicator.ready",
  error: "experiencia.vision.indicator.error"
} as const;

const DOT = {
  starting: "bg-warn animate-pulse",
  ready: "bg-ok",
  error: "bg-danger"
} as const;

/**
 * Small composer-side readout of the vision stack, shown only while vision is
 * on. The state comes from the backend (`ready` only once the model is
 * resident); this component never infers it. The error reason is an enum code
 * mapped to friendly copy, never raw text.
 */
export function VisionStateIndicator({ state }: { state: VisionComposerState }) {
  const t = useT();
  if (state.phase === "off") return null;
  const label = t(LABEL[state.phase]);
  const title = state.phase === "error" && state.reason ? t(visionReasonKey(state.reason)) : undefined;
  return (
    <p
      role="status"
      data-vision-state={state.phase}
      aria-label={label}
      title={title}
      className="mono mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-dim"
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOT[state.phase])} />
      <span aria-hidden="true">{label}</span>
    </p>
  );
}
