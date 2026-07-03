import { create } from "zustand";

export interface PendingSwitch {
  name: string;
  commandId: string;
  // "timeout" (F2/design D6): soft-timeout terminal state — surfaced when a
  // switch hasn't converged within APPLY_TIMEOUT_MS, so the UI can offer
  // "still applying / retry" instead of hanging on "applying" forever.
  status: "queued" | "applying" | "timeout";
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
  markTimeout(): void;
}

export const useSwitchStore = create<SwitchStoreState>((set) => ({
  pendingSwitch: null,
  setPending: (pending) => set({ pendingSwitch: pending }),
  clearPending: () => set({ pendingSwitch: null }),
  markTimeout: () =>
    set((state) => (state.pendingSwitch ? { pendingSwitch: { ...state.pendingSwitch, status: "timeout" } } : state))
}));
