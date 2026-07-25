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
  /**
   * A PTT hold is open RIGHT NOW. Written from two complementary places, both
   * describing the SAME single-slot server session, so they can only agree:
   *  - `usePttHold`'s state transitions (instant, in-app hold surfaces)
   *  - `usePttServerSignal`'s 1Hz GET /api/ptt/state poll (~1s, and the ONLY
   *    thing that sees the external F10 bridge, which never touches this app)
   * The backend's status `avatar_state` structurally cannot report listening,
   * which is why this lives client-side at all.
   */
  listening: boolean;
  /** Heartbeat receipt for `listening` (client clock). Refreshed by every
   * keepalive/poll tick while held, so a long hold stays fresh; never displayed. */
  lastPttTs: number;
  setSpeaking(speaking: boolean): void;
  setListening(listening: boolean): void;
}

export const useAvatarLiveState = create<AvatarLiveState>((set, get) => ({
  speaking: false,
  lastEventTs: 0,
  listening: false,
  lastPttTs: 0,
  setSpeaking: (speaking) => set({ speaking, lastEventTs: Date.now() }),
  setListening: (listening) => {
    // The server signal polls forever at 1Hz. Stamping a new lastPttTs on every
    // idle tick would re-render every subscriber once a second for nothing, so
    // an unchanged "not listening" is a hard no-op. While held, each write IS
    // the heartbeat and must land.
    if (!listening && !get().listening) return;
    set({ listening, lastPttTs: Date.now() });
  }
}));
