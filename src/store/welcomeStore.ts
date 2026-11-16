import { create } from "zustand";

export const WELCOME_STORAGE_KEY = "oc-welcome-dismissed-v1";

export interface WelcomeState {
  dismissed: boolean;
  /** Session-only counter bumped by every explicit "show welcome" request.
   * The setup assistant slot reopens when it changes, independently of the
   * persisted `dismissed` flag (the backend owns first-run state). */
  reopenSeq: number;
  dismiss(): void;
  restore(): void;
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistDismissed(dismissed: boolean): void {
  try {
    window.localStorage.setItem(WELCOME_STORAGE_KEY, String(dismissed));
  } catch {
    // Storage is best-effort; the in-memory preference remains usable.
  }
}

export const useWelcomeStore = create<WelcomeState>((set) => ({
  dismissed: readDismissed(),
  reopenSeq: 0,
  dismiss: () => {
    set({ dismissed: true });
    persistDismissed(true);
  },
  restore: () => {
    set((state) => ({ dismissed: false, reopenSeq: state.reopenSeq + 1 }));
    persistDismissed(false);
  }
}));
