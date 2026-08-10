import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

/* ------------------------------------------------------------------ */
/*  Toast — stackable notification system                              */
/*  Tone palette mirrors Badge/Snackbar (info-design token palette).   */
/*  Uses a provider + hook pattern: wrap your app in <ToastProvider>,  */
/*  then call `useToast().toast(...)` from anywhere.                   */
/* ------------------------------------------------------------------ */

export type ToastTone = "ok" | "warn" | "danger" | "info" | "neutral";
export type ToastPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "bottom-center";

const toneClasses: Record<ToastTone, string> = {
  ok: "bg-ok-bg border-ok-bd text-ok",
  warn: "bg-warn-bg border-warn-bd text-warn",
  danger: "bg-danger-bg border-danger-bd text-danger",
  info: "bg-info-bg border-info-bd text-info",
  neutral: "bg-surface-2 border-border text-foreground",
};

const dotClasses: Record<ToastTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground opacity-50",
};

const positionClasses: Record<ToastPosition, string> = {
  "top-right": "top-4 right-4 items-end",
  "top-left": "top-4 left-4 items-start",
  "bottom-right": "bottom-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
};

// --- Types ---

export interface ToastOptions {
  /** Semantic tone — maps to the info-design token palette. @default "neutral" */
  tone?: ToastTone;
  /** Auto-dismiss delay in ms. `0` = stays until manually dismissed. @default 4000 */
  duration?: number;
  /** Optional title rendered above the message. */
  title?: string;
}

interface ToastEntry extends Required<Pick<ToastOptions, "tone" | "duration">> {
  id: string;
  message: ReactNode;
  title?: string;
  phase: "enter" | "visible" | "exit";
}

interface ToastContextValue {
  toast: (message: ReactNode, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

// --- Context ---

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}

// --- Provider ---

export interface ToastProviderProps {
  children: ReactNode;
  /** Where toasts stack. @default "top-right" */
  position?: ToastPosition;
  /** Max simultaneous toasts. Oldest gets dismissed. @default 5 */
  max?: number;
}

export function ToastProvider({
  children,
  position = "top-right",
  max = 5,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, phase: "exit" as const } : t)),
    );
  }, []);

  const removeAfterExit = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: ReactNode, options: ToastOptions = {}): string => {
      const id = `toast-${++counterRef.current}`;
      const entry: ToastEntry = {
        id,
        message,
        title: options.title,
        tone: options.tone ?? "neutral",
        duration: options.duration ?? 4000,
        phase: "enter",
      };

      setToasts((prev) => {
        const next = [...prev, entry];
        // enforce max — dismiss oldest if over limit
        if (next.length > max) {
          const oldest = next.find((t) => t.phase !== "exit");
          if (oldest) {
            return next.map((t) =>
              t.id === oldest.id ? { ...t, phase: "exit" as const } : t,
            );
          }
        }
        return next;
      });

      // kick enter → visible on next frame
      requestAnimationFrame(() => {
        setToasts((prev) =>
          prev.map((t) =>
            t.id === id && t.phase === "enter"
              ? { ...t, phase: "visible" as const }
              : t,
          ),
        );
      });

      return id;
    },
    [max],
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}

      {/* toast viewport */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-label="Notifications"
          className={cn(
            "fixed z-50 flex flex-col gap-2 pointer-events-none",
            positionClasses[position],
          )}
        >
          {toasts.map((t) => (
            <ToastItem
              key={t.id}
              entry={t}
              position={position}
              onDismiss={dismiss}
              onExited={removeAfterExit}
            />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// --- Individual Toast ---

function ToastItem({
  entry,
  position,
  onDismiss,
  onExited,
}: {
  entry: ToastEntry;
  position: ToastPosition;
  onDismiss: (id: string) => void;
  onExited: (id: string) => void;
}) {
  // auto-dismiss timer
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const startTimer = useCallback(() => {
    if (entry.duration === 0) return;
    timerRef.current = setTimeout(() => onDismiss(entry.id), entry.duration);
  }, [entry.duration, entry.id, onDismiss]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // start timer when visible
  if (entry.phase === "visible" && !timerRef.current && entry.duration > 0) {
    startTimer();
  }

  const handleTransitionEnd = () => {
    if (entry.phase === "exit") onExited(entry.id);
  };

  // slide direction based on position
  const isTop = position.startsWith("top");
  const slideOut = isTop ? "-translate-y-2" : "translate-y-2";
  const translateClass =
    entry.phase === "enter" || entry.phase === "exit"
      ? `${slideOut} opacity-0 scale-95`
      : "translate-y-0 opacity-100 scale-100";

  return (
    <div
      role="status"
      onTransitionEnd={handleTransitionEnd}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      className={cn(
        "pointer-events-auto flex w-80 items-start gap-3 rounded-lg border px-4 py-3 shadow-soft",
        "backdrop-blur-md",
        toneClasses[entry.tone],
        "transition-all duration-slow ease-out",
        translateClass,
      )}
    >
      {/* status dot */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-1 h-[6px] w-[6px] shrink-0 rounded-full",
          dotClasses[entry.tone],
        )}
      />

      {/* content */}
      <div className="flex-1 min-w-0">
        {entry.title && (
          <p className="mb-0.5 text-sm font-bold leading-snug">{entry.title}</p>
        )}
        <p className="text-sm leading-snug opacity-90">{entry.message}</p>
      </div>

      {/* dismiss */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(entry.id)}
        className="shrink-0 rounded-md p-1 text-current opacity-60 transition-opacity duration-fast ease-io hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
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
