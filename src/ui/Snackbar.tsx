import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { useT } from "../i18n/t.js";

/* ------------------------------------------------------------------ */
/*  Snackbar — bottom-anchored feedback bar                           */
/*  Tone palette mirrors Badge (--ok/--warn/--danger/--info tokens).  */
/*  Renders fixed at the viewport bottom-center.                      */
/* ------------------------------------------------------------------ */

export type SnackbarTone = "ok" | "warn" | "danger" | "info" | "neutral";

const toneClasses: Record<SnackbarTone, string> = {
  ok: "bg-ok-bg border-ok-bd text-ok",
  warn: "bg-warn-bg border-warn-bd text-warn",
  danger: "bg-danger-bg border-danger-bd text-danger",
  info: "bg-info-bg border-info-bd text-info",
  neutral: "bg-surface-2 border-border text-foreground",
};

const dotClasses: Record<SnackbarTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground opacity-50",
};

export interface SnackbarProps {
  /** Controls visibility. Parent owns the open state. */
  open: boolean;
  /** Called when the snackbar wants to close (timeout or dismiss). */
  onClose: () => void;
  /** Semantic tone — maps to the info-design token palette. */
  tone?: SnackbarTone;
  /** Message content. */
  children: ReactNode;
  /** Optional action label (e.g. "Undo"). */
  action?: string;
  /** Fired when the action button is clicked. */
  onAction?: () => void;
  /** Auto-dismiss delay in ms. `0` = stays until manually dismissed. @default 5000 */
  duration?: number;
  className?: string;
}

export function Snackbar({
  open,
  onClose,
  tone = "neutral",
  children,
  action,
  onAction,
  duration = 5000,
  className,
}: SnackbarProps) {
  const t = useT();
  // --- animation state: mount → visible → exit → unmount ---
  const [phase, setPhase] = useState<"enter" | "visible" | "exit" | "idle">("idle");

  useEffect(() => {
    if (open) {
      setPhase("enter");
      // trigger reflow so the enter transition fires
      const raf = requestAnimationFrame(() => setPhase("visible"));
      return () => cancelAnimationFrame(raf);
    }
    if (!open && phase === "visible") {
      setPhase("exit");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-dismiss timer
  useEffect(() => {
    if (phase !== "visible" || duration === 0) return;
    const id = setTimeout(() => onClose(), duration);
    return () => clearTimeout(id);
  }, [phase, duration, onClose]);

  const handleTransitionEnd = useCallback(() => {
    if (phase === "exit") setPhase("idle");
  }, [phase]);

  if (phase === "idle" && !open) return null;

  const translateClass =
    phase === "enter" || phase === "exit"
      ? "translate-y-4 opacity-0"
      : "translate-y-0 opacity-100";

  return (
    <div
      role="status"
      aria-live="polite"
      onTransitionEnd={handleTransitionEnd}
      className={cn(
        // layout — fixed bottom center
        "fixed bottom-6 left-1/2 z-50 -translate-x-1/2",
        // surface
        "flex items-center gap-3 rounded-lg border px-4 py-3 shadow-soft",
        "backdrop-blur-md",
        // tone
        toneClasses[tone],
        // animation
        "transition-all duration-slow ease-out",
        translateClass,
        className,
      )}
    >
      {/* status dot */}
      <span
        aria-hidden="true"
        className={cn("h-[6px] w-[6px] shrink-0 rounded-full", dotClasses[tone])}
      />

      {/* message */}
      <span className="text-sm font-medium leading-snug">{children}</span>

      {/* optional action */}
      {action && (
        <button
          type="button"
          onClick={() => {
            onAction?.();
            onClose();
          }}
          className={cn(
            "ml-2 shrink-0 rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wider",
            "bg-[image:var(--accent-grad)] text-primary-foreground",
            "transition-colors duration-fast ease-io hover:brightness-110",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          {action}
        </button>
      )}

      {/* dismiss */}
      <button
        type="button"
        aria-label={t("ui.snackbar.dismiss.aria")}
        onClick={onClose}
        className="ml-1 shrink-0 rounded-md p-1 text-current opacity-60 transition-opacity duration-fast ease-io hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
