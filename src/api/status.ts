import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStatus, rotateIdempotencyKey } from "./client.js";
import { useSwitchStore } from "../store/switchStore.js";

export const STATUS_QUERY_KEY = ["status"] as const;

// Design D6: soft timeout before a stuck "applying" state surfaces as
// terminal instead of hanging forever.
const APPLY_TIMEOUT_MS = 15000;

export function useStatusQuery() {
  return useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: getStatus,
    refetchInterval: 2000,
    refetchIntervalInBackground: false
  });
}

/**
 * accepted≠applied reconcile (design D6 / spec R5). Watches the live status
 * poll and clears the Zustand `pendingSwitch` only when `active_profile`
 * matches `target` — never optimistically. Also rotates that target's
 * Idempotency-Key on convergence (F1) so a later re-switch to the same
 * target is a fresh intent, not a replay of the completed command.
 */
export function usePollUntilApplied(target: string | null) {
  const statusQuery = useStatusQuery();
  const clearPending = useSwitchStore((state) => state.clearPending);
  const markTimeout = useSwitchStore((state) => state.markTimeout);

  useEffect(() => {
    if (target && statusQuery.data?.active_profile === target) {
      rotateIdempotencyKey(target);
      clearPending();
    }
  }, [target, statusQuery.data?.active_profile, clearPending]);

  useEffect(() => {
    if (!target) {
      return;
    }
    const timer = setTimeout(() => {
      markTimeout();
    }, APPLY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [target, markTimeout]);

  return statusQuery;
}
