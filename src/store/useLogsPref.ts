import { create } from "zustand";

const STORAGE_KEY = "oc-show-logs";

function readStoredShowLogs(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface LogsPrefState {
  showLogs: boolean;
  setShowLogs(next: boolean): void;
}

export const useLogsPrefStore = create<LogsPrefState>((set) => ({
  showLogs: readStoredShowLogs(),
  setShowLogs: (next) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // best-effort persistence; the in-memory flip still holds
    }
    set({ showLogs: next });
  }
}));

/**
 * "Mostrar logs" preference (R36/D11) — a module-singleton zustand store
 * persisted to localStorage["oc-show-logs"], mirroring theme/useDensity.ts's
 * read-on-init + write-through pattern (no DOM side effect here, just
 * persistence). Gates whether the Logs column tab is present (default OFF).
 */
export function useLogsPref() {
  const showLogs = useLogsPrefStore((state) => state.showLogs);
  const setShowLogs = useLogsPrefStore((state) => state.setShowLogs);
  return { showLogs, setShowLogs };
}
