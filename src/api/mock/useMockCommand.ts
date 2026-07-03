import { useCallback, useState } from "react";

export type MockCommandStatus = "idle" | "applying";

const DEFAULT_DELAY_MS = 60;

/**
 * Mirrors the accepted != applied contract from useProfileSwitch (see
 * src/api/useProfileSwitch.tsx) but fully local — no network, no queue. Used
 * by Controles cards that have no backend endpoint yet (model/tier, voice
 * config): run() flips `pending` true immediately, then false after a short
 * simulated delay, so the UI shows the same disable-while-applying /
 * Badge(info) "aplicando…" affordance it will need once a real mutation
 * exists.
 *
 * One instance == one logical mutation (call the hook once per control, not
 * once per card) so exactly one control disables while it "applies" — this
 * maps 1:1 to a set of real per-endpoint `useMutation()` hooks, not one
 * shared hook coupling unrelated controls.
 *
 * `variables` mirrors react-query's `mutation.variables` — the payload is
 * actually consumed (stored, not discarded) so this reads like a real
 * mutation result, not a stub.
 *
 * Swap-to-real: replace the setTimeout body with the real mutation call
 * (e.g. useMutation(...).mutateAsync) — callers only ever see
 * {pending, variables, run}.
 */
export function useMockCommand<T = void>(delayMs: number = DEFAULT_DELAY_MS) {
  const [status, setStatus] = useState<MockCommandStatus>("idle");
  const [variables, setVariables] = useState<T | undefined>(undefined);

  const run = useCallback(
    (payload?: T) =>
      new Promise<void>((resolve) => {
        setVariables(payload);
        setStatus("applying");
        setTimeout(() => {
          setStatus("idle");
          resolve();
        }, delayMs);
      }),
    [delayMs]
  );

  return { pending: status === "applying", variables, run };
}
