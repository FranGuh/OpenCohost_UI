import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleCheck, CircleDashed, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "../lib/cn.js";

export type AlertTone = "ok" | "warn" | "danger" | "info" | "neutral";

export interface AlertProps {
  tone?: AlertTone;
  /** Optional bold first line. */
  title?: string;
  children: ReactNode;
  /** ARIA live-region role. Default "alert" (assertive — interrupts the
   * screen reader). Pass "status" for historical/log lines that must not
   * interrupt (e.g. the conversation event feed). */
  role?: "alert" | "status";
  className?: string;
}

const TONE_ICON: Record<AlertTone, LucideIcon> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  danger: OctagonAlert,
  info: Info,
  neutral: CircleDashed
};

/**
 * One DOM shape, three CSS-only style variants keyed off `data-alert-style`
 * on <html> (see src/theme/useAlertStyle.ts + the .oc-alert rules in
 * styles.css) — presence via weight/border/icon, not color. The tone drives
 * only the icon color and (in "marcado"/"contorno") the border; the surface
 * stays neutral by default (spec §3d).
 */
export function Alert({ tone = "neutral", title, children, role = "alert", className }: AlertProps) {
  const Icon = TONE_ICON[tone];
  return (
    <div role={role} className={cn("oc-alert", className)} data-tone={tone}>
      <Icon className="oc-alert-icon" size={14} aria-hidden="true" />
      <div>
        {title && <p className="oc-alert-title">{title}</p>}
        <p className="oc-alert-body">{children}</p>
      </div>
    </div>
  );
}
