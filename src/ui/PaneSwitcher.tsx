import { useState } from "react";
import type { ReactNode } from "react";
import { Segmented } from "./Segmented.js";
import type { SegmentedOption } from "./Segmented.js";

function readPersistedValue<T extends string>(storageKey: string, options: readonly SegmentedOption<T>[]): T {
  const fallback = options[0].value;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored !== null && options.some((option) => option.value === stored)) return stored as T;
  } catch {
    // best-effort read; falls through to the default below
  }
  return fallback;
}

export interface UsePaneSwitcherResult<T extends string> {
  /** The resolved pane value — validated against `options`, so the caller
   *  never has to guard against a corrupt/unknown persisted string. */
  value: T;
  /** The Segmented control, wired to this hook's value/persistence. Render it
   *  wherever it belongs (e.g. a non-scrolling header slot) — the caller
   *  decides both placement and what body follows from `value`. */
  switcher: ReactNode;
}

/**
 * One pane mounted at a time, selection persisted to localStorage — the
 * pattern MemoriaPanel introduced, extracted so Controles and Agenda don't
 * each reinvent the read/validate/write dance. This primitive owns the
 * Segmented control and its persistence only; it has no idea what a "pane"
 * is for any given caller, and never decides what to render for a value.
 *
 * Read and write are both best-effort (try/catch, same idiom as
 * AppLayout.tsx's sidebar-collapsed persistence and MemoriaPanel's original
 * inline version) — a blocked/full localStorage must never crash the switch,
 * only fail to remember it.
 */
export function usePaneSwitcher<T extends string>(
  options: readonly SegmentedOption<T>[],
  storageKey: string,
  ariaLabel: string
): UsePaneSwitcherResult<T> {
  const [value, setValue] = useState<T>(() => readPersistedValue(storageKey, options));

  function select(next: T) {
    setValue(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // best-effort persistence; the in-memory selection still holds
    }
  }

  return {
    value,
    switcher: <Segmented options={options} value={value} onChange={select} ariaLabel={ariaLabel} />
  };
}
