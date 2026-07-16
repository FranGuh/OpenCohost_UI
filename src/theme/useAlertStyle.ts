import { create } from "zustand";

export const ALERT_STYLES = ["sereno", "marcado", "contorno"] as const;
export type AlertStyle = (typeof ALERT_STYLES)[number];

const STORAGE_KEY = "oc-alert-style";
const DEFAULT_ALERT_STYLE: AlertStyle = "sereno";

function isAlertStyle(value: string | null): value is AlertStyle {
  return value !== null && (ALERT_STYLES as readonly string[]).includes(value);
}

function readStoredAlertStyle(): AlertStyle {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isAlertStyle(stored) ? stored : DEFAULT_ALERT_STYLE;
}

function applyAlertStyle(style: AlertStyle) {
  document.documentElement.dataset.alertStyle = style;
  window.localStorage.setItem(STORAGE_KEY, style);
}

interface AlertStyleStoreState {
  alertStyle: AlertStyle;
  setAlertStyle(next: AlertStyle): void;
  /** Test-only: module singleton, see useTheme.ts's identical seam. */
  _hydrateForTests(): void;
}

// Same module-singleton pattern as useTheme.ts/useDensity.ts: applied at
// module init so data-alert-style is set before first paint on any render
// path that imports this module.
const initialAlertStyle = readStoredAlertStyle();
document.documentElement.dataset.alertStyle = initialAlertStyle;

export const useAlertStyleStore = create<AlertStyleStoreState>((set) => ({
  alertStyle: initialAlertStyle,
  setAlertStyle: (next) => {
    applyAlertStyle(next);
    set({ alertStyle: next });
  },
  _hydrateForTests: () => {
    const alertStyle = readStoredAlertStyle();
    document.documentElement.dataset.alertStyle = alertStyle;
    set({ alertStyle });
  }
}));

/**
 * "Estilo de alertas" preference (gear popover, Wave 2 — spec §3d): sereno /
 * marcado / contorno. Sets `data-alert-style` on <html> (styles.css's
 * .oc-alert rules re-skin from there — instant, no re-render needed) and
 * persists the choice to localStorage.
 */
export function useAlertStyle() {
  const alertStyle = useAlertStyleStore((state) => state.alertStyle);
  const setAlertStyle = useAlertStyleStore((state) => state.setAlertStyle);
  return { alertStyle, setAlertStyle };
}
