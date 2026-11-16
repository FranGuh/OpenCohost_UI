import { useCallback, useEffect, useRef, useState } from "react";
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
import { TTS_CONFIG_QUERY_KEY } from "./tts.js";
import { useEventStore } from "../store/eventStore.js";

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
export interface UseEngineCommandOptions {
  manualConvergence?: boolean;
  onError?: (error: unknown) => void;
  onTimeout?: () => void;
  onFailed?: () => void;
}

export function useEngineCommand<TValue = unknown>(
  matches?: (status: StatusResponse, value: TValue) => boolean,
  options: UseEngineCommandOptions = {}
) {
  const queryClient = useQueryClient();
  const statusQuery = useStatusQuery();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const pendingCommandRef = useRef<PendingCommand | null>(null);
  const changePendingCommand = useCallback((next: PendingCommand | null) => {
    pendingCommandRef.current = next;
    setPendingCommand(next);
  }, []);
  const [convergeValue, setConvergeValue] = useState<TValue | undefined>(undefined);
  const [timedOut, setTimedOut] = useState(false);
  const [failed, setFailed] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({ command, value }: { command: EngineCommand; value?: TValue }) => {
      const intentKey = intentKeyFor(command, value);
      const key = getIdempotencyKey(intentKey);
      const controller = new AbortController();
      let requestTimedOut = false;
      const timeoutTimer = setTimeout(() => {
        requestTimedOut = true;
        controller.abort(new DOMException("Engine command request timed out", "TimeoutError"));
      }, APPLY_TIMEOUT_MS);
      try {
        const accepted = await postCommand(command, value, key, { signal: controller.signal });
        return { accepted, intentKey };
      } catch (error) {
        if (requestTimedOut) {
          setTimedOut(true);
          optionsRef.current.onTimeout?.();
        }
        throw error;
      } finally {
        clearTimeout(timeoutTimer);
      }
    },
    // Item A event engine: command NAME is metadata (never the response
    // body) — see src/lib/appEvents.ts, the single privacy chokepoint.
    meta: {
      event: (variables) => {
        const { command, value } = variables as { command: EngineCommand; value?: unknown };
        if (command === "switch_model") return { source: "model", action: "switch", detail: String(value ?? "") };
        if (command === "clear_history") return { source: "settings", action: "clear-history" };
        return { source: "settings", action: "update", detail: command };
      }
    },
    onSuccess: (result: { accepted: CommandAccepted; intentKey: string }, variables) => {
      setTimedOut(false);
      setFailed(false);
      setConvergeValue(variables.value);
      changePendingCommand({ intentKey: result.intentKey });
    },
    onError: (error) => {
      optionsRef.current.onError?.(error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      // S5: any engine command can change the active model (switch_model
      // directly, but also profile-driven commands) — ModelCard's
      // useModelsQuery must not stay stale.
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
      if (!optionsRef.current.manualConvergence) {
        void queryClient.invalidateQueries({ queryKey: TTS_CONFIG_QUERY_KEY });
      }
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
      changePendingCommand(null);
      setFailed(false);
      setTimedOut(false);
    }
  }, [changePendingCommand, matches, pendingCommand, statusQuery.data, convergeValue]);

  // Optimistic convergence for commands with no `matches` predicate.
  useEffect(() => {
    if (matches || options.manualConvergence || !pendingCommand) {
      return;
    }
    const timer = setTimeout(() => {
      rotateIdempotencyKey(pendingCommand.intentKey);
      changePendingCommand(null);
      setFailed(false);
      setTimedOut(false);
    }, OPTIMISTIC_APPLY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [changePendingCommand, matches, options.manualConvergence, pendingCommand]);

  // Immediate failure resolution: when the backend fires a failure event
  // (model_switch_failed, llm_tier_switch_failed), clear pending immediately
  // instead of holding the control disabled until the 15s timeout ceiling.
  useEffect(() => {
    if (!pendingCommand) {
      return;
    }
    return useEventStore.subscribe((state) => {
      const latest = state.events[state.events.length - 1];
      if (!latest) return;
      if (
        latest.source === "motor" &&
        (latest.action === "model_switch_failed" || latest.action === "llm_tier_switch_failed")
      ) {
        changePendingCommand(null);
        setFailed(true);
        optionsRef.current.onFailed?.();
      }
    });
  }, [changePendingCommand, pendingCommand]);

  // Soft timeout ceiling for both strategies above — never rotates the
  // Idempotency-Key (unlike genuine convergence) since we don't know
  // whether the original command is still in flight; a retry of the same
  // intent safely replays/dedupes against it instead of double-dispatching.
  useEffect(() => {
    if (!pendingCommand) {
      return;
    }
    const timer = setTimeout(() => {
      changePendingCommand(null);
      setTimedOut(true);
      optionsRef.current.onTimeout?.();
    }, APPLY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [changePendingCommand, pendingCommand]);

  // Swallow the rejection here — mutation.isError/error already carry it
  // reactively, so callers (cards) can `void run(...)` without every call
  // site needing its own .catch() to avoid an unhandled rejection.
  const run = useCallback(
    (command: EngineCommand, value?: TValue) => {
      setTimedOut(false);
      setFailed(false);
      return mutation.mutateAsync({ command, value }).catch(() => undefined);
    },
    [mutation]
  );

  const confirmApplied = useCallback(
    (command: EngineCommand, value: TValue) => {
      const intentKey = intentKeyFor(command, value);
      if (pendingCommandRef.current?.intentKey !== intentKey) return;
      rotateIdempotencyKey(intentKey);
      changePendingCommand(null);
      setFailed(false);
      setTimedOut(false);
    },
    [changePendingCommand]
  );

  const stopWaiting = useCallback(() => {
    // Do not rotate the intent key: after a read timeout the command may still
    // be queued, so a retry must safely replay the same idempotent request.
    changePendingCommand(null);
    setTimedOut(false);
  }, [changePendingCommand]);

  const reset = useCallback(() => {
    mutation.reset();
    setTimedOut(false);
    setFailed(false);
  }, [mutation]);

  return {
    run,
    confirmApplied,
    stopWaiting,
    pending: mutation.isPending || pendingCommand !== null,
    isError: mutation.isError || failed,
    error: mutation.error,
    // Terminal "still applying, try again" state (design D6) — surfaced
    // once APPLY_TIMEOUT_MS elapses without convergence; NOT a permanent
    // disable, `pending` is false again once this is true.
    isTimeout: timedOut,
    isFailed: failed,
    reset
  };
}
