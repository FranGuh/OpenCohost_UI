import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * Decision layer endpoint (opencohost/api/routers/decisions.py) is newer than
 * the OpenAPI snapshot, so this module is hand-typed, the same self-contained
 * pattern as src/api/replyLength.ts.
 *
 * Errors: 422 `invalid_decision_setting` (also for respond with mode "on"),
 * 503 `decision_settings_write_failed`. Both surface as a plain ApiError
 * carrying the status.
 */

export const DECISION_IDS = ["vision", "memory", "reply_length", "respond"] as const;
export type DecisionId = (typeof DECISION_IDS)[number];

export const DECISION_MODES = ["off", "shadow", "on"] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

export interface DecisionSetting {
  mode: DecisionMode;
  threshold: number;
}

export type DecisionWorkerState = "off" | "starting" | "ready" | "error" | "unavailable";

export interface DecisionWorker {
  configured: boolean;
  state: DecisionWorkerState;
  checkpoint: string | null;
  last_error: string | null;
}

export interface DecisionsResponse {
  decisions: Record<DecisionId, DecisionSetting>;
  worker: DecisionWorker;
  budget_ms: number;
}

export type DecisionsPatch = Partial<Record<DecisionId, Partial<DecisionSetting>>>;

const PATH = "/api/decisions";
const RESTART_PATH = "/api/decisions/worker/restart";

export async function getDecisions(): Promise<DecisionsResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`);
  if (!res.ok) {
    throw new ApiError(`GET ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as DecisionsResponse;
}

export async function putDecisions(decisions: DecisionsPatch): Promise<DecisionsResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisions })
  });
  if (!res.ok) {
    throw new ApiError(`PUT ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as DecisionsResponse;
}

export async function restartDecisionWorker(): Promise<DecisionWorker> {
  const res = await authFetch(`${getApiBaseUrl()}${RESTART_PATH}`, { method: "POST" });
  if (!res.ok) {
    throw new ApiError(`POST ${RESTART_PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as DecisionWorker;
}

export const DECISIONS_QUERY_KEY = ["decisions"] as const;

export function useDecisionsQuery() {
  return useQuery({ queryKey: DECISIONS_QUERY_KEY, queryFn: getDecisions });
}

/**
 * Optimistic save: the cache merges the partial immediately, rolls back to the
 * snapshot on any failure, and is replaced by the server's response on success.
 */
export function useDecisionsSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putDecisions,
    onMutate: async (patch: DecisionsPatch) => {
      await queryClient.cancelQueries({ queryKey: DECISIONS_QUERY_KEY });
      const previous = queryClient.getQueryData<DecisionsResponse>(DECISIONS_QUERY_KEY);
      if (previous) {
        const merged = { ...previous.decisions };
        for (const id of DECISION_IDS) {
          if (patch[id]) merged[id] = { ...merged[id], ...patch[id] };
        }
        queryClient.setQueryData<DecisionsResponse>(DECISIONS_QUERY_KEY, { ...previous, decisions: merged });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(DECISIONS_QUERY_KEY, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(DECISIONS_QUERY_KEY, saved)
  });
}

export function useDecisionWorkerRestart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restartDecisionWorker,
    onSuccess: (worker) => {
      queryClient.setQueryData<DecisionsResponse>(DECISIONS_QUERY_KEY, (current) =>
        current ? { ...current, worker } : current
      );
    }
  });
}
