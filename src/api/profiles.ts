import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { ConflictError, NotFoundError, getPerfiles, switchProfile } from "./client.js";
import { useSwitchStore } from "../store/switchStore.js";
import { STATUS_QUERY_KEY } from "./status.js";

export const PROFILES_QUERY_KEY = ["perfiles"] as const;

export function useProfilesQuery() {
  return useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: getPerfiles
  });
}

export function useSwitchProfileMutation() {
  const queryClient = useQueryClient();
  const setPending = useSwitchStore((state) => state.setPending);
  const clearPending = useSwitchStore((state) => state.clearPending);

  // Design D5: Idempotency-Key is stable per switch INTENT, reused across
  // retries of that intent. ponytail: keyed per target name for this hook's
  // mount lifetime — good enough for P1 (only 5xx/network retries realistically
  // repeat the same target); cleared on conflict/not-found below so a later,
  // distinct attempt at the same target gets a fresh key.
  const idempotencyKeys = useRef(new Map<string, string>());

  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      let key = idempotencyKeys.current.get(name);
      if (!key) {
        key = crypto.randomUUID();
        idempotencyKeys.current.set(name, key);
      }
      return switchProfile(name, key);
    },
    onSuccess: (result, variables) => {
      // No optimistic active_profile write (design D6) — only local
      // queued/applying UI state; the poll in usePollUntilApplied confirms.
      setPending({ name: variables.name, commandId: result.command_id, status: "applying" });
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onError: (error, variables) => {
      if (error instanceof NotFoundError) {
        // Unknown profile: whatever was pending is now stale, drop it.
        clearPending();
        idempotencyKeys.current.delete(variables.name);
      } else if (error instanceof ConflictError) {
        // Regenerate the key so a manual retry is a fresh intent.
        idempotencyKeys.current.delete(variables.name);
      }
      // QueueFullError (429): keep the same key for manual retry, leave
      // pendingSwitch untouched — never flip to "applying" on error.
    }
  });
}
