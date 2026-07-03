import { create } from "zustand";

export interface PendingSwitch {
  name: string;
  commandId: string;
  status: "queued" | "applying";
}

/**
 * LOCAL UI state ONLY (design D10 / spec R8). Must never hold server-truth
 * fields (active_profile, is_ready, health, current_model, ...) — those come
 * exclusively from TanStack Query hooks in src/api/*.
 */
export interface SwitchStoreState {
  pendingSwitch: PendingSwitch | null;
  setPending(pending: PendingSwitch): void;
  clearPending(): void;
}

export const useSwitchStore = create<SwitchStoreState>((set) => ({
  pendingSwitch: null,
  setPending: (pending) => set({ pendingSwitch: pending }),
  clearPending: () => set({ pendingSwitch: null })
}));
