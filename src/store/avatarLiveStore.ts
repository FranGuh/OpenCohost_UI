import { create } from "zustand";

/**
 * LOCAL UI state ONLY (same contract as switchStore/eventStore): a client-side
 * mirror of the engine's speaking edge, fed from the GET /api/events poll in
 * src/api/events.ts (motor.speaking_start -> true, speaking_end/idle -> false).
 * Never holds server-truth or dialogue — just a boolean plus the receipt
 * timestamp so KiraCover can react to speaking a poll-cycle sooner than the 2s
 * status query. `lastEventTs` is Date.now() at receipt (client clock), used
 * only as a freshness guard, never displayed.
 */
export interface AvatarLiveState {
  speaking: boolean;
  lastEventTs: number; // 0 = no live signal received yet
  setSpeaking(speaking: boolean): void;
}

export const useAvatarLiveState = create<AvatarLiveState>((set) => ({
  speaking: false,
  lastEventTs: 0,
  setSpeaking: (speaking) => set({ speaking, lastEventTs: Date.now() })
}));
