import { create } from "zustand";

const STORAGE_KEY = "oc-ui-locale";
export const UI_LOCALES = ["es", "en"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
const DEFAULT_LOCALE: UiLocale = "es"; // today's behaviour, byte for byte

function readStored(): UiLocale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return (UI_LOCALES as readonly string[]).includes(stored ?? "") ? (stored as UiLocale) : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function apply(next: UiLocale) {
  // index.html hardcodes lang="en" while the whole UI is Spanish today — a
  // pre-existing accessibility defect (screen readers pick the wrong voice).
  // Writing the real locale here fixes it for free.
  document.documentElement.lang = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // best-effort persistence; the in-memory flip still holds
  }
}

interface UiLocaleState {
  locale: UiLocale;
  setLocale(next: UiLocale): void;
}

const initial = readStored();
document.documentElement.lang = initial;

export const useUiLocaleStore = create<UiLocaleState>((set) => ({
  locale: initial,
  setLocale: (next) => {
    apply(next);
    set({ locale: next });
  }
}));

/**
 * UI-locale preference — mirrors theme/useDensity.ts's module-singleton,
 * read-on-init + write-through pattern, with the defensive try/catch from
 * store/useLogsPref.ts so a storage-denied environment degrades to
 * DEFAULT_LOCALE instead of breaking module initialisation for the app.
 */
export function useUiLocale() {
  const locale = useUiLocaleStore((state) => state.locale);
  const setLocale = useUiLocaleStore((state) => state.setLocale);
  return { locale, setLocale };
}
