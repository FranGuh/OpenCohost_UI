import { createContext, useContext, useId } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../../lib/cn.js";

// The `inert` string-attribute idiom (inert="" present / inert={undefined}
// absent) and its `declare module "react"` augmentation already live in
// Collapsible.tsx. That augmentation is global to the TS project, so it is
// reused here without redeclaring (ponytail: no duplicate ambient decl).

/* ------------------------------------------------------------------ */
/*  Tabs — minimal accessible controlled tab widget (D1/D2)            */
/*  <Tabs value onValueChange> / <TabList ariaLabel> / <Tab value> /   */
/*  <TabPanel value>. Inactive panels stay MOUNTED but hidden + inert  */
/*  + aria-hidden (mirrors Collapsible's focusable-hidden-content fix) */
/*  so scroll/focus/in-progress state survive a tab switch (R6).       */
/* ------------------------------------------------------------------ */

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs.* must be rendered inside <Tabs>");
  return ctx;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const baseId = useId();
  return (
    <TabsContext.Provider value={{ value, onValueChange, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}

export function TabList({ ariaLabel, children, className }: TabListProps) {
  const { onValueChange } = useTabsContext();

  // Automatic-activation tab pattern: Arrow/Home/End move focus AND selection
  // (R4). The ordered tab set is read straight off the DOM, so no child
  // registration bookkeeping is needed. Clamp at both ends (no wrap).
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (tabs.length === 0) return;

    let current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current === -1) current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");

    let next = current;
    if (event.key === "ArrowRight") next = Math.min(current + 1, tabs.length - 1);
    else if (event.key === "ArrowLeft") next = Math.max(current - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;

    if (next < 0 || next === current) return;
    event.preventDefault();
    const target = tabs[next];
    target.focus();
    const nextValue = target.dataset.value;
    if (nextValue) onValueChange(nextValue);
  }

  return (
    <div role="tablist" aria-label={ariaLabel} onKeyDown={handleKeyDown} className={className}>
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function Tab({ value, children, className }: TabProps) {
  const ctx = useTabsContext();
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${value}`}
      data-value={value}
      aria-selected={selected}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => ctx.onValueChange(value)}
      className={className}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className }: TabPanelProps) {
  const ctx = useTabsContext();
  const active = ctx.value === value;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      hidden={!active}
      inert={!active ? "" : undefined}
      aria-hidden={!active}
      className={cn(!active && "pointer-events-none", className)}
    >
      {children}
    </div>
  );
}
