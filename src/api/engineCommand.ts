import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CommandAccepted,
  type EngineCommand,
  type StatusResponse,
  getIdempotencyKey,
  postCommand,
  rotateIdempotencyKey
} from "./client.js";
import { STATUS_QUERY_KEY, useStatusQuery } from "./status.js";
import { MODELS_QUERY_KEY } from "./models.js";

interface PendingCommand {
  intentKey: string;
}

// Design D6 (mirrors src/api/status.ts's usePollUntilApplied): soft ceiling
// before a stuck "applying" state surfaces as terminal instead of disabling
// the control forever.
const APPLY_TIMEOUT_MS = 15000;

// Commands with no `matches` predicate have no real "applied" field to poll
// for (state_version is an ACCEPT counter bumped at enqueue time — GET
// /api/status never advances it again once the engine applies the command,
// so it can never signal "applied"). The accept itself is real (the
// dispatcher genuinely enqueued it), so these converge optimistically after
// a brief pending instead of waiting on a signal that doesn't exist.
const OPTIMISTIC_APPLY_DELAY_MS = 400;

/**
 * Idempotency-Key intent for an engine command: stable per (command, value)
 * pair, same design D5 as switchProfile's per-target key — a retry of the
 * SAME command+value reuses the key, a different value gets a fresh one.
 * `clear_history` takes no value, so the command name alone is the intent.
 */
function intentKeyFor(command: EngineCommand, value: unknown): string {
  return command === "clear_history" ? command : `${command}:${JSON.stringify(value)}`;
}

/**
 * Real accepted != applied command control (spec B2/B3) — same `{pending,
 * run}` contract as useMockCommand, but wired to POST /api/commands + the
 * shared GET /api/status poll (usePollUntilApplied's sibling for engine
 * commands instead of profile switches).
 *
 * Convergence is NEVER `state_version` (that's an accept-time counter, not
 * an applied signal — see APPLY_TIMEOUT_MS comment above). Two strategies:
 *  - `matches` provided (e.g. switch_model -> current_model === target):
 *    converge only when the real applied field changes on the status poll.
 *  - no `matches` (lightweight settings with no applied field to observe):
 *    converge optimistically a short beat after accept.
 * Either way, a soft APPLY_TIMEOUT_MS ceiling clears the pending state and
 * surfaces a terminal "still applying / try again" flag instead of
 * disabling the control forever.
 *
 * One instance == one logical command control (call once per UI control, not
 * once per card) so exactly one disables while it applies — mirrors
 * useMockCommand's contract 1:1.
 */
export function useEngineCommand<TValue = unknown>(matches?: (status: StatusResponse, value: TValue) => boolean) {
  const queryClient = useQueryClient();
  const statusQuery = useStatusQuery();
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const [convergeValue, setConvergeValue] = useState<TValue | undefined>(undefined);
  const [timedOut, setTimedOut] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({ command, value }: { command: EngineCommand; value?: TValue }) => {
      const intentKey = intentKeyFor(command, value);
      const key = getIdempotencyKey(intentKey);
      const accepted = await postCommand(command, value, key);
      return { accepted, intentKey };
    },
    onSuccess: (result: { accepted: CommandAccepted; intentKey: string }, variables) => {
      setTimedOut(false);
      setConvergeValue(variables.value);
      setPendingCommand({ intentKey: result.intentKey });
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      // S5: any engine command can change the active model (switch_model
      // directly, but also profile-driven commands) — ModelCard's
      // useModelsQuery must not stay stale.
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
    }
  });

  // Real-field convergence: only resolved by `matches()` against the live
  // status poll.
  useEffect(() => {
    if (!matches || !pendingCommand || !statusQuery.data) {
      return;
    }
    if (matches(statusQuery.data, convergeValue as TValue)) {
      rotateIdempotencyKey(pendingCommand.intentKey);
      setPendingCommand(null);
    }
  }, [matches, pendingCommand, statusQuery.data, convergeValue]);

  // Optimistic convergence for commands with no `matches` predicate.
  useEffect(() => {
    if (matches || !pendingCommand) {
      return;
    }
    const timer = setTimeout(() => {
      rotateIdempotencyKey(pendingCommand.intentKey);
      setPendingCommand(null);
    }, OPTIMISTIC_APPLY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [matches, pendingCommand]);

  // Soft timeout ceiling for both strategies above — never rotates the
  // Idempotency-Key (unlike genuine convergence) since we don't know
  // whether the original command is still in flight; a retry of the same
  // intent safely replays/dedupes against it instead of double-dispatching.
  useEffect(() => {
    if (!pendingCommand) {
      return;
    }
    const timer = setTimeout(() => {
      setPendingCommand(null);
      setTimedOut(true);
    }, APPLY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingCommand]);

  // Swallow the rejection here — mutation.isError/error already carry it
  // reactively, so callers (cards) can `void run(...)` without every call
  // site needing its own .catch() to avoid an unhandled rejection.
  const run = useCallback(
    (command: EngineCommand, value?: TValue) => mutation.mutateAsync({ command, value }).catch(() => undefined),
    [mutation]
  );

  const reset = useCallback(() => {
    mutation.reset();
    setTimedOut(false);
  }, [mutation]);

  return {
    run,
    pending: mutation.isPending || pendingCommand !== null,
    isError: mutation.isError,
    error: mutation.error,
    // Terminal "still applying, try again" state (design D6) — surfaced
    // once APPLY_TIMEOUT_MS elapses without convergence; NOT a permanent
    // disable, `pending` is false again once this is true.
    isTimeout: timedOut,
    reset
  };
}
