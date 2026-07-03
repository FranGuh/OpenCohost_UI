import { create } from "zustand";

const STORAGE_KEY = "oc-density";

function readStoredCompact(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "compact";
}

function applyDensity(compact: boolean) {
  if (compact) {
    document.documentElement.dataset.density = "compact";
  } else {
    delete document.documentElement.dataset.density;
  }
  window.localStorage.setItem(STORAGE_KEY, compact ? "compact" : "comfortable");
}

interface DensityStoreState {
  compact: boolean;
  setCompact(next: boolean): void;
}

const initialCompact = readStoredCompact();
if (initialCompact) {
  document.documentElement.dataset.density = "compact";
}

export const useDensityStore = create<DensityStoreState>((set) => ({
  compact: initialCompact,
  setCompact: (next) => {
    applyDensity(next);
    set({ compact: next });
  }
}));

/**
 * Client-side "Compacto" density preference (gear popover, Wave 1b) —
 * mirrors useTheme.ts's module-singleton pattern (one shared source, no
 * per-component useState desync). Sets `data-density="compact"` on
 * <html> (styles.css tightens the p-4/gap-3.5 spacing ladder from there)
 * and persists the choice to localStorage.
 */
export function useDensity() {
  const compact = useDensityStore((state) => state.compact);
  const setCompact = useDensityStore((state) => state.setCompact);
  return { compact, setCompact };
}
