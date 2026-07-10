import { create } from "zustand";

export const WELCOME_STORAGE_KEY = "oc-welcome-dismissed-v1";

export interface WelcomeState {
  dismissed: boolean;
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
  dismiss: () => {
    set({ dismissed: true });
    persistDismissed(true);
  },
  restore: () => {
    set({ dismissed: false });
    persistDismissed(false);
  }
}));
