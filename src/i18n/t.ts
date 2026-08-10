import { EN, ES, type TKey } from "./bundles.js";
import { useUiLocaleStore } from "./locale.js";

export type { TKey };

export function t(key: TKey, vars?: Record<string, string | number>): string {
  const dict = useUiLocaleStore.getState().locale === "en" ? EN : ES;
  const raw = dict[key];
  return vars ? raw.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m)) : raw;
}

/** Subscribes the caller to locale changes, then hands back `t`. */
export function useT() {
  useUiLocaleStore((s) => s.locale);
  return t;
}
