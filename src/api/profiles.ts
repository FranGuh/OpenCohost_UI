import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ConflictError,
  NotFoundError,
  type StatusResponse,
  getIdempotencyKey,
  getPerfiles,
  rotateIdempotencyKey,
  switchProfile
} from "./client.js";
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

  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      // Design D5: Idempotency-Key is stable per switch INTENT (per target),
      // reused across retries. Key lives in client.ts's module-scope
      // registry (not a hook-local ref) so it can be rotated on
      // CONVERGENCE by usePollUntilApplied (see status.ts) — otherwise a
      // later re-switch to an already-converged target would replay the
      // completed command and never re-enqueue (F1).
      const key = getIdempotencyKey(name);
      return switchProfile(name, key);
    },
    onSuccess: (result, variables) => {
      const currentStatus = queryClient.getQueryData<StatusResponse>(STATUS_QUERY_KEY);
      if (currentStatus?.active_profile === variables.name) {
        // Target is already the active profile (no-op switch, or this
        // response is confirming a state that already converged) — resolve
        // cleanly instead of flashing "applying" with nothing to poll for.
        rotateIdempotencyKey(variables.name);
        clearPending();
        void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
        return;
      }

      const pending = useSwitchStore.getState().pendingSwitch;
      if (pending?.name === variables.name && pending.commandId === result.command_id) {
        // R6: idempotent replay of an already-registered pending intent —
        // do not re-trigger a redundant "applying" transition.
        return;
      }

      // No optimistic active_profile write (design D6) — only local
      // queued/applying UI state; the poll in usePollUntilApplied confirms.
      setPending({ name: variables.name, commandId: result.command_id, status: "applying" });
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
    onError: (error, variables) => {
      if (error instanceof NotFoundError) {
        // Unknown profile: whatever was pending is now stale, drop it.
        clearPending();
        rotateIdempotencyKey(variables.name);
      } else if (error instanceof ConflictError) {
        // Regenerate the key so a manual retry is a fresh intent.
        rotateIdempotencyKey(variables.name);
      }
      // QueueFullError (429): keep the same key for manual retry, leave
      // pendingSwitch untouched — never flip to "applying" on error.
    }
  });
}
