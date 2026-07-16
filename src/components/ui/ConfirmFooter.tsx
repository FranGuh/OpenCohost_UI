import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Alert } from "./Alert.js";
import { Button } from "./Button.js";
import { cn } from "../../lib/cn.js";

export interface ConfirmStage {
  /** Danger message shown FIRST, above every control (message-first contract). */
  message: ReactNode;
  /** Label of the advancing footer button for this stage. */
  advanceLabel: string;
  /** When set, an acknowledgment toggle must be pressed before advance enables. */
  acknowledgment?: string;
}

export interface ConfirmFooterProps {
  /** Whether the confirm flow is engaged. The parent owns the entry trigger. */
  active: boolean;
  /** Ordered stages; the LAST stage's advance button is the destructive action. */
  stages: ConfirmStage[];
  /** Fired when the last stage's destructive button is pressed. */
  onConfirm(): void;
  /** Fired when the user backs out (Cancelar / Escape). The parent flips `active` off. */
  onCancel(): void;
  /** Disables the destructive advance while the real mutation is pending. */
  busy?: boolean;
  cancelLabel?: string;
  /** Optional opt-in control (e.g. a purge checkbox) rendered under the message. */
  children?: ReactNode;
  className?: string;
}

/**
 * Reusable destructive-confirmation footer. Message-FIRST, then optional opt-in
 * / acknowledgment controls, then a mutating button row (Cancelar + an advance
 * button). Supports N stages: intermediate stages advance to the next, the last
 * stage fires `onConfirm`. An acknowledgment toggle (when a stage sets one)
 * gates its advance; the final advance is styled filled-danger. Escape and
 * Cancelar both reset via `onCancel`. Owns only stage/ack state — the parent
 * owns `active` (so it can swap this block in for its own footer buttons).
 */
export function ConfirmFooter({
  active,
  stages,
  onConfirm,
  onCancel,
  busy = false,
  cancelLabel = "Cancelar",
  children,
  className
}: ConfirmFooterProps) {
  const [stageIndex, setStageIndex] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset to a clean first stage whenever the flow disengages, so re-entering
  // always starts from stage 0 with the acknowledgment cleared.
  useEffect(() => {
    if (!active) {
      setStageIndex(0);
      setAcknowledged(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onCancel]);

  if (!active || stages.length === 0) return null;

  const index = Math.min(stageIndex, stages.length - 1);
  const stage = stages[index];
  const isLast = index === stages.length - 1;
  const advanceGated = (stage.acknowledgment != null && !acknowledged) || (isLast && busy);

  function handleAdvance() {
    if (isLast) {
      onConfirm();
      return;
    }
    setStageIndex((value) => value + 1);
    setAcknowledged(false);
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Alert tone="danger" role="status">
        {stage.message}
      </Alert>

      {children}

      {stage.acknowledgment != null && (
        <button
          type="button"
          aria-pressed={acknowledged}
          onClick={() => setAcknowledged((value) => !value)}
          className={cn(
            "inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-fast ease-io",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            acknowledged
              ? "border-danger-bd bg-danger-bg text-danger"
              : "border-border bg-card text-muted-foreground hover:border-danger-bd hover:text-foreground"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid h-4 w-4 place-items-center rounded-[4px] border",
              acknowledged ? "border-danger bg-danger text-primary-foreground" : "border-border"
            )}
          >
            {acknowledged && <Check size={12} strokeWidth={3} />}
          </span>
          {stage.acknowledgment}
        </button>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        {isLast ? (
          <button
            type="button"
            disabled={advanceGated}
            onClick={handleAdvance}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-transparent bg-danger px-4 text-sm font-semibold text-primary-foreground transition-[filter] duration-fast ease-io",
              "hover:opacity-90 disabled:opacity-50",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            )}
          >
            {stage.advanceLabel}
          </button>
        ) : (
          <Button type="button" variant="outline" disabled={advanceGated} onClick={handleAdvance}>
            {stage.advanceLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
