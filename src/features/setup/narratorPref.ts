/** Persisted choice: does the setup narrator stay silent? Same defensive localStorage pattern as oc-ui-locale. */
export const NARRATOR_MUTED_KEY = "oc-setup-narrator-muted";

export function readNarratorMuted(): boolean {
  try {
    return window.localStorage.getItem(NARRATOR_MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeNarratorMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(NARRATOR_MUTED_KEY, muted ? "1" : "0");
  } catch {
    // best-effort persistence; the in-memory choice still holds
  }
}

/** True once the user has answered (or toggled) the narrator question on this machine. */
export function hasNarratorPref(): boolean {
  try {
    return window.localStorage.getItem(NARRATOR_MUTED_KEY) !== null;
  } catch {
    return false;
  }
}
