import { create } from "zustand";

/**
 * Per-state content version for served avatar art
 * (tauri_avatar_upload_20260911, judge finding BLOCKER).
 *
 * The served URL is a pure function of state, so a re-upload of the same
 * state yields the identical string: without a version the KiraCover `<img>`
 * never re-requests (and a parked error-fallback never repaints). The upload
 * mutation bumps the state on success; KiraCover appends `&v=` and resets
 * its error fallback when the version changes.
 */
interface AvatarImageVersionState {
  versions: Record<string, number>;
  bump(state: string): void;
}

export const useAvatarImageVersion = create<AvatarImageVersionState>((set) => ({
  versions: {},
  bump: (state) =>
    set((current) => ({ versions: { ...current.versions, [state]: (current.versions[state] ?? 0) + 1 } }))
}));
