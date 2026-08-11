import { useId, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

// @types/react 18.3.x doesn't type the native `inert` attribute in its stable
// HTMLAttributes (only react/experimental.d.ts has it), and react-dom 18
// doesn't recognise `inert` as a boolean-valued DOM attribute either (it warns
// on `inert={false}` — a real boolean value isn't a "boolean attribute" to
// React unless it's on its own hardcoded allowlist). So this is typed and used
// as a string attribute: `inert=""` (present) / `inert={undefined}` (absent),
// same as the `disabled=""` idiom, which is what the DOM actually reads.
declare module "react" {
  interface HTMLAttributes<T> {
    inert?: "";
  }
}

/* ------------------------------------------------------------------ */
/*  Collapsible — shared card section toggle                          */
/*  Extracted from StreamPanel's local pattern so any panel can reuse  */
/*  the same collapse/expand behaviour.                               */
/* ------------------------------------------------------------------ */

export interface CollapsibleHeaderProps {
  isOpen: boolean;
  onToggle: () => void;
  /** DOM id of the matching CollapsibleBody, wired into aria-controls so
   *  assistive tech can find the section this header expands/collapses.
   *  Omit for callers that don't share an id with their CollapsibleBody. */
  bodyId?: string;
  children: ReactNode;
}

/** Clickable card header with a ▾ chevron that rotates when collapsed. */
export function CollapsibleHeader({ isOpen, onToggle, bodyId, children }: CollapsibleHeaderProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      aria-controls={bodyId}
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
  /** Stable DOM id for this body. Pass the same value to the matching
   *  CollapsibleHeader's `bodyId` prop so aria-controls resolves. Falls back
   *  to a generated id (React useId) when the caller doesn't supply one, so
   *  the element always has a stable id even without aria-controls wiring. */
  id?: string;
  children: ReactNode;
}

/**
 * Animated panel body — grid-rows trick for smooth height transition.
 *
 * Collapsed content used to stay mounted, exposed to the accessibility tree,
 * and keyboard-focusable despite aria-expanded="false" on the header — a
 * destructive action inside a "closed" section could still be tabbed to and
 * activated. `inert` (belt-and-braces `pointer-events-none` too, since jsdom
 * doesn't enforce `inert`) plus `aria-hidden` close that hole while keeping
 * the content mounted so the grid-rows height animation still works.
 */
export function CollapsibleBody({ isOpen, id, children }: CollapsibleBodyProps) {
  const fallbackId = useId();
  const bodyId = id ?? fallbackId;
  return (
    <div
      id={bodyId}
      inert={!isOpen ? "" : undefined}
      aria-hidden={!isOpen}
      className={cn(
        "grid transition-all duration-base ease-io",
        isOpen ? "grid-rows-[1fr] opacity-100 mt-3.5" : "grid-rows-[0fr] opacity-0 mt-0 pointer-events-none"
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
   *  one level below the card's bold h2 (each caller's own card-level
   *  `<h2 className="text-sm font-bold text-foreground">` — e.g. MemoryCard,
   *  PersonalizationCard, EditorialCardsCard — is the sibling of this). */
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
  // persistKey is already required to be unique (it doubles as the localStorage
  // key), so deriving the shared header/body id from it is a safe, stable choice.
  const bodyId = `oc-collapsible-body-${persistKey}`;
  return (
    <section>
      <CollapsibleHeader isOpen={isOpen} onToggle={toggle} bodyId={bodyId}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">{title}</span>
      </CollapsibleHeader>
      <CollapsibleBody isOpen={isOpen} id={bodyId}>{children}</CollapsibleBody>
    </section>
  );
}
