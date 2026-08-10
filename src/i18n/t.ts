import { useMemo } from "react";
import { EN, ES, type TKey } from "./bundles.js";
import { useUiLocaleStore, type UiLocale } from "./locale.js";

export type { TKey };

/**
 * Exhaustive by construction. A `locale === "en" ? EN : ES` ternary would let a
 * third locale be added to UI_LOCALES, become selectable and persistable, and
 * then silently render Spanish — no compile error, no runtime error. This
 * Record makes that omission a `tsc` failure instead.
 */
const DICTIONARIES: Record<UiLocale, Record<TKey, string>> = { es: ES, en: EN };

export function t(key: TKey, vars?: Record<string, string | number>): string {
  const raw = DICTIONARIES[useUiLocaleStore.getState().locale][key];
  return vars ? raw.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m)) : raw;
}

/**
 * Subscribes the caller to locale changes, then hands back `t`.
 *
 * The returned function's IDENTITY changes with the locale, deliberately. `t`
 * itself is a module-level function, so a `useMemo`/`useCallback` that lists it
 * as a dependency would never re-run on a locale flip and would serve a stale
 * string. Handing back a fresh closure per locale makes the ordinary React
 * dependency rule ("list what you use") correct for copy too.
 */
export function useT(): typeof t {
  const locale = useUiLocaleStore((s) => s.locale);
  return useMemo(() => ((key, vars) => t(key, vars)) as typeof t, [locale]);
}
