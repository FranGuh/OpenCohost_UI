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
        className={cn("shrink-0 text-xs text-dim transition-transform duration-200", !isOpen && "-rotate-90")}
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
        "grid transition-all duration-200 ease-in-out",
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

/** Returns `[isOpen, toggle]` — saves two lines in every consumer. */
export function useCollapsible(defaultOpen = true): [boolean, () => void] {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return [isOpen, () => setIsOpen((o) => !o)];
}
