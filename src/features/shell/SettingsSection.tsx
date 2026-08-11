import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export const PANEL_CLASS = "flex min-h-0 flex-col gap-3.5 overflow-auto p-4";
export const PANEL_GRADIENT = "radial-gradient(60% 40% at 50% 0%, var(--accent-soft), transparent 70%)";

export interface SettingsSectionProps {
  /** Fixed content pinned outside the scroll region (e.g. a pane switcher).
   *  Omit it for a section that has nothing to pin — see below. */
  header?: ReactNode;
  children: ReactNode;
}

/**
 * Shared `<main>` shell for a Controles/Agenda/Stream/Música/Memoria-style
 * settings section, extracted from MainStage so a panel can pin a header
 * outside the scrolling region without reaching for `position: sticky`
 * (needs negative-margin tricks + an opaque background + z-index to span
 * MainStage's own padding) or `backdrop-filter` (makes the element a
 * containing block for `position: fixed` descendants — see
 * UI_CONSTRAINTS_LEARNED.md §1).
 *
 * No header: renders exactly what MainStage rendered inline before this
 * split — one `<main className={PANEL_CLASS}>`, the single scroll owner.
 *
 * With a header: the same idiom as Sidebar.tsx (nav + footer `shrink-0`,
 * only ProfilesRegion scrolls) — the header sits in a `shrink-0` slot, and
 * PANEL_CLASS moves, unforked, onto the `flex-1` body below it so the body
 * keeps the exact padding/gap/scroll behaviour it always had.
 */
export function SettingsSection({ header, children }: SettingsSectionProps) {
  if (!header) {
    return (
      <main className={PANEL_CLASS} style={{ backgroundImage: PANEL_GRADIENT }}>
        {children}
      </main>
    );
  }
  return (
    <main className="flex min-h-0 flex-col overflow-hidden" style={{ backgroundImage: PANEL_GRADIENT }}>
      <div className="shrink-0 px-4 pt-4">{header}</div>
      <div className={cn(PANEL_CLASS, "flex-1")}>{children}</div>
    </main>
  );
}
