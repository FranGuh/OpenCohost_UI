import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStatus } from "./client.js";
import { useSwitchStore } from "../store/switchStore.js";

export const STATUS_QUERY_KEY = ["status"] as const;

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
 * matches `target` — never optimistically.
 */
export function usePollUntilApplied(target: string | null) {
  const statusQuery = useStatusQuery();
  const clearPending = useSwitchStore((state) => state.clearPending);

  useEffect(() => {
    if (target && statusQuery.data?.active_profile === target) {
      clearPending();
    }
  }, [target, statusQuery.data?.active_profile, clearPending]);

  return statusQuery;
}
