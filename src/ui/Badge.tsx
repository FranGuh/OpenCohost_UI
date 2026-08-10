import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export type BadgeTone = "ok" | "warn" | "danger" | "info" | "neutral";

// Info-design principle (decision #2827): dot + tinted bg, never an alarming
// solid fill. Tone reads at a glance without shouting.
const toneClasses: Record<BadgeTone, string> = {
  ok: "bg-ok-bg border-ok-bd text-ok",
  warn: "bg-warn-bg border-warn-bd text-warn",
  danger: "bg-danger-bg border-danger-bd text-danger",
  info: "bg-info-bg border-info-bd text-info",
  neutral: "bg-surface-2 border-border text-muted-foreground"
};

const dotClasses: Record<BadgeTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground opacity-50"
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  /** Technical/numeric content (model name, id) — renders in mono/tabular. */
  mono?: boolean;
}

export function Badge({ tone = "neutral", children, className, mono = false }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap rounded-md border px-[11px] py-[6px] text-[12.5px] font-semibold",
        toneClasses[tone],
        mono && "mono",
        className
      )}
    >
      <span aria-hidden="true" className={cn("h-[10px] w-[5px] rounded-full", dotClasses[tone])} />
      {children}
    </span>
  );
}
