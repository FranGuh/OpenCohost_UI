import { useEffect, useState } from "react";
import { create } from "zustand";

/**
 * Inactivity timeout after which Kira dozes off.
 * Set to 10 minutes (extended desktop companion presence).
 */
export const SLEEP_AFTER_IDLE_MS = 10 * 60 * 1000;

const STORAGE_LAST_ACTIVITY = "oc-inactivity-last-ts";
const STORAGE_ASLEEP = "oc-inactivity-asleep";
const EVENT_LOCAL_ACTIVITY = "oc-inactivity-local-activity";

/**
 * Notify all windows (via localStorage & local event) that user activity occurred.
 */
export function recordSharedActivity(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  try {
    window.localStorage.setItem(STORAGE_LAST_ACTIVITY, String(now));
    window.localStorage.setItem(STORAGE_ASLEEP, "false");
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVENT_LOCAL_ACTIVITY, { detail: { ts: now } }));
  } catch {}
}

/**
 * Notify all windows (via localStorage) that the avatar should doze off.
 */
export function setSharedAsleep(asleep: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_ASLEEP, String(asleep));
  } catch {}
}

export interface InactivityState {
  lastActivityTs: number;
  asleep: boolean;
  recordActivity(): void;
  setAsleep(asleep: boolean): void;
  resetForTesting(): void;
}

export const useInactivityStore = create<InactivityState>((set) => ({
  lastActivityTs: Date.now(),
  asleep: false,
  recordActivity: recordSharedActivity,
  setAsleep: setSharedAsleep,
  resetForTesting: () => {
    try {
      window.localStorage.removeItem(STORAGE_LAST_ACTIVITY);
      window.localStorage.removeItem(STORAGE_ASLEEP);
    } catch {}
  },
}));

/**
 * Shared hook driving the 10-minute inactivity countdown.
 *
 * Resilient behavior:
 * - When `busy` is true, keeps Kira awake and resets timer.
 * - When idle for 10 minutes (SLEEP_AFTER_IDLE_MS), triggers doze (`asleep = true`).
 * - Listens to `storage` events so activity or sleep state in the desktop companion
 *   window synchronizes in real time with the main window, and vice versa.
 */
export function useSharedInactivityDoze(busy: boolean, activityTs = 0): boolean {
  const [asleep, setAsleep] = useState(false);
  const [activitySignal, setActivitySignal] = useState(0);

  // If busy (speaking, listening, processing), wake up and record activity
  useEffect(() => {
    if (busy) {
      setAsleep(false);
      recordSharedActivity();
    }
  }, [busy]);

  // Synchronize across Tauri WebViews via storage events and local events
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_LAST_ACTIVITY) {
        setAsleep(false);
        setActivitySignal((s) => s + 1);
      } else if (e.key === STORAGE_ASLEEP) {
        if (e.newValue === "true") {
          setAsleep(true);
        } else if (e.newValue === "false") {
          setAsleep(false);
          setActivitySignal((s) => s + 1);
        }
      }
    };

    const handleLocal = () => {
      setAsleep(false);
      setActivitySignal((s) => s + 1);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(EVENT_LOCAL_ACTIVITY, handleLocal);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(EVENT_LOCAL_ACTIVITY, handleLocal);
    };
  }, []);

  // A batched speech start/end can leave busy unchanged; its timestamp still
  // records activity and must restart the shared countdown.
  useEffect(() => {
    if (activityTs > 0) recordSharedActivity();
  }, [activityTs]);

  // Inactivity countdown
  useEffect(() => {
    if (busy) return;

    setAsleep(false);
    const timer = setTimeout(() => {
      setAsleep(true);
      setSharedAsleep(true);
    }, SLEEP_AFTER_IDLE_MS);

    return () => clearTimeout(timer);
  }, [busy, activitySignal]);

  return asleep;
}
