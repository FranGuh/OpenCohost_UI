import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

/* ------------------------------------------------------------------ */
/*  Collapsible — shared card section toggle                          */
/*  Extracted from StreamPanel's local pattern so any panel can reuse  */
/*  the same collapse/expand behaviour.                               */
/* ------------------------------------------------------------------ */

export interface CollapsibleHeaderProps {
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Clickable card header with a ▾ chevron that rotates when collapsed. */
export function CollapsibleHeader({ isOpen, onToggle, children }: CollapsibleHeaderProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
      }}
      className={cn(
        "flex cursor-pointer select-none items-center justify-between gap-3",
        isOpen && "border-b border-border-soft pb-3"
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn("shrink-0 text-xs text-dim transition-transform duration-base ease-io", !isOpen && "-rotate-90")}
      >
        ▾
      </span>
    </div>
  );
}

export interface CollapsibleBodyProps {
  isOpen: boolean;
  children: ReactNode;
}

/** Animated panel body — grid-rows trick for smooth height transition. */
export function CollapsibleBody({ isOpen, children }: CollapsibleBodyProps) {
  return (
    <div
      className={cn(
        "grid transition-all duration-base ease-io",
        isOpen ? "grid-rows-[1fr] opacity-100 mt-3.5" : "grid-rows-[0fr] opacity-0 mt-0"
      )}
    >
      {/* overflow-hidden only while collapsed so the grid-rows animation clips
          correctly, but removed when open so absolutely-positioned dropdowns
          (Select listbox) are never cut off by this boundary. */}
      <div className={cn("min-h-0", !isOpen && "overflow-hidden")}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  useCollapsible — convenience hook for local open state             */
/* ------------------------------------------------------------------ */

/** localStorage key for a persisted section — "1" open / "0" collapsed. */
function collapseKey(persistKey: string): string {
  return `oc-collapse-${persistKey}`;
}

function readPersistedOpen(persistKey: string | undefined, defaultOpen: boolean): boolean {
  if (!persistKey) return defaultOpen;
  try {
    const raw = window.localStorage.getItem(collapseKey(persistKey));
    return raw === null ? defaultOpen : raw === "1";
  } catch {
    return defaultOpen;
  }
}

/**
 * Returns `[isOpen, toggle]` — saves two lines in every consumer.
 *
 * With a `persistKey`, the initial state hydrates from
 * `localStorage["oc-collapse-<persistKey>"]` ("1"/"0") and every toggle writes
 * through, so a section's open/collapsed state survives the component
 * unmounting on panel navigation. Without a `persistKey`, behaviour is
 * unchanged: in-memory only, seeded from `defaultOpen`.
 */
export function useCollapsible(defaultOpen = true, persistKey?: string): [boolean, () => void] {
  const [isOpen, setIsOpen] = useState(() => readPersistedOpen(persistKey, defaultOpen));
  function toggle() {
    setIsOpen((open) => {
      const next = !open;
      if (persistKey) {
        try {
          window.localStorage.setItem(collapseKey(persistKey), next ? "1" : "0");
        } catch {
          // best-effort persistence; the in-memory flip still holds
        }
      }
      return next;
    });
  }
  return [isOpen, toggle];
}

/* ------------------------------------------------------------------ */
/*  SubCollapsibleSection — subordinate collapsible inside a card      */
/* ------------------------------------------------------------------ */

export interface SubCollapsibleSectionProps {
  /** Sub-section label — rendered in the card sub-label type ramp, so it reads
   *  one level below the card's bold h2 (ControlsPanel.ControlGroup is the
   *  card-level sibling of this). */
  title: ReactNode;
  /** Persists open/collapsed under localStorage["oc-collapse-<persistKey>"]. */
  persistKey: string;
  /** Initial state before any stored value hydrates (default open). */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A thin, subordinate collapsible for the interior of a card — composes the
 * shared CollapsibleHeader/CollapsibleBody/useCollapsible so its open state
 * persists like every other section, but its header uses the smaller uppercase
 * sub-label ramp instead of the card's bold heading.
 */
export function SubCollapsibleSection({ title, persistKey, defaultOpen = true, children }: SubCollapsibleSectionProps) {
  const [isOpen, toggle] = useCollapsible(defaultOpen, persistKey);
  return (
    <section>
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">{title}</span>
      </CollapsibleHeader>
      <CollapsibleBody isOpen={isOpen}>{children}</CollapsibleBody>
    </section>
  );
}
