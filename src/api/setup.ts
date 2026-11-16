import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authFetch, getApiBaseUrl, getStatus } from "./client.js";

/**
 * Setup assistant endpoints (setup-assistant-20261008). Hand-typed against the
 * feature doc's API contract — the routes are newer than the OpenAPI snapshot,
 * same self-contained pattern as src/api/speech.ts.
 *
 * The backend is the source of truth for whether the assistant opens on start
 * (`show_on_start`); the UI never derives that from localStorage unless the
 * route itself is unreachable (see SetupWelcomeSlot).
 */
export type SetupStatus = "pending" | "skipped" | "completed";

export interface SetupStateResponse {
  status: SetupStatus;
  /** Cloud profile with a stored key, OR Ollama with at least one installed model. */
  engine_ready: boolean;
  engine: "local" | "cloud" | null;
  show_on_start: boolean;
  /** S10: where an interrupted setup resumes; null when there is none. Older backends omit it. */
  checkpoint?: SetupCheckpoint | null;
  /** One-shot: a bad checkpoint file was moved aside on this read. */
  checkpoint_reset?: "corrupt" | "unsupported_version" | null;
  /** An earlier OpenCohost install was detected (read-only). The welcome says this version starts fresh. */
  legacy_install?: boolean;
}

/**
 * Non-secret wizard answers saved with the checkpoint. The backend keeps an
 * explicit allowlist and drops anything else; never put a key or chat here.
 */
export interface SetupCheckpointAnswers {
  language: "es" | "en" | null;
  hear_kira: boolean | null;
  engine: "gpu" | "cpu" | "cloud" | null;
  model: string | null;
  model_ready: boolean;
  cloud_preset: string | null;
  cloud_model: string | null;
  voice: "unknown" | "ok" | "off";
  voice_kind: "piper" | "edge" | null;
  test_verdict: "passed" | "slow" | "failed" | null;
  personalize: boolean | null;
  avatar: "3d" | "2d" | null;
}

export interface SetupCheckpointBody {
  version: number;
  step: string;
  answers: SetupCheckpointAnswers;
}

export interface SetupCheckpoint extends SetupCheckpointBody {
  updated_at: string;
}

export type InferenceVerdict = "passed" | "slow" | "failed";

export type InferenceErrorCode =
  | "ollama_unreachable"
  | "model_missing"
  | "timeout"
  | "cloud_auth"
  | "cloud_rate_limit"
  | "cloud_bad_request"
  | "cloud_error"
  | "busy";

/** Each metric is a number or null — the backend never invents a 0. */
export interface InferenceMetrics {
  load_ms: number | null;
  first_token_ms: number | null;
  tokens_per_second: number | null;
}

export interface InferenceRun extends InferenceMetrics {
  ok: boolean;
}

export interface InferenceTestResponse {
  status: InferenceVerdict;
  provider: "local" | "cloud";
  model: string | null;
  metrics: InferenceMetrics;
  runs: InferenceRun[];
  error_code: InferenceErrorCode | null;
  /** Cloud HTTP failures only: the status and a sanitized, bounded provider message (never a key). */
  http_status?: number | null;
  provider_message?: string | null;
}

export const SETUP_STATE_QUERY_KEY = ["setup", "state"] as const;

export async function getSetupState(): Promise<SetupStateResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/setup/state`);
  if (!res.ok) {
    throw new ApiError(`GET /api/setup/state failed with ${res.status}`, res.status);
  }
  return (await res.json()) as SetupStateResponse;
}

export async function putSetupState(status: SetupStatus): Promise<SetupStateResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/setup/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!res.ok) {
    throw new ApiError(`PUT /api/setup/state failed with ${res.status}`, res.status);
  }
  return (await res.json()) as SetupStateResponse;
}

/** Saves where the setup is (S10). Callers treat it as fire-and-forget: a failure never blocks the user. */
export async function putSetupCheckpoint(body: SetupCheckpointBody): Promise<void> {
  const res = await authFetch(`${getApiBaseUrl()}/api/setup/checkpoint`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`PUT /api/setup/checkpoint failed with ${res.status}`, res.status);
  }
}

/** Forgets the saved progress ("Empezar de nuevo"). Fire-and-forget like the save. */
export async function deleteSetupCheckpoint(): Promise<void> {
  const res = await authFetch(`${getApiBaseUrl()}/api/setup/checkpoint`, { method: "DELETE" });
  if (!res.ok) {
    throw new ApiError(`DELETE /api/setup/checkpoint failed with ${res.status}`, res.status);
  }
}

/** Runs the backend's fixed-prompt speed test on the active engine model (1..5 runs). */
export async function postInferenceTest(runs = 3): Promise<InferenceTestResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/setup/inference-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runs })
  });
  if (!res.ok) {
    throw new ApiError(`POST /api/setup/inference-test failed with ${res.status}`, res.status);
  }
  return (await res.json()) as InferenceTestResponse;
}

export interface WaitForModelOptions {
  /** Ceiling for a cold load of a large model (the engine's own warm-up budget is 120 s). */
  timeoutMs?: number;
  intervalMs?: number;
  /** Checked around every status read; true aborts the wait (e.g. a model_switch_failed event arrived). */
  failed?: () => boolean;
}

/**
 * POST /api/commands only means "queued": the engine may still be loading the
 * model, defer the switch while it is busy, or reject it after the accept.
 * Resolves true once GET /api/status reports `tag` as the current model, false
 * on failure or timeout. A status read error is retried until the deadline.
 */
export async function waitForActiveModel(
  tag: string,
  { timeoutMs = 120_000, intervalMs = 750, failed }: WaitForModelOptions = {}
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (failed?.()) return false;
    try {
      if ((await getStatus()).current_model === tag) return true;
    } catch {
      // A transient status failure is not a verdict; keep polling until the deadline.
    }
    if (failed?.() || Date.now() + intervalMs > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Display a metric; null renders as "—" so a missing value never reads as 0. */
export function formatMetric(value: number | null, unit: "ms" | "tps"): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return unit === "ms" ? `${(value / 1000).toFixed(1)} s` : value.toFixed(1);
}

/**
 * Reads on mount and fails fast (no retry) so the welcome slot can fall back.
 * While the "no engine" hint predicate holds (skipped and not engine_ready) it
 * re-reads every 5s, so the hint clears once the engine comes up after app
 * start; polling stops as soon as the predicate no longer holds. A failed
 * read keeps the last data and just waits for the next tick (no hot loop).
 */
export function useSetupStateQuery() {
  return useQuery({
    queryKey: SETUP_STATE_QUERY_KEY,
    queryFn: getSetupState,
    retry: false,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.status === "skipped" && !query.state.data.engine_ready ? 5_000 : false
  });
}

export function useUpdateSetupState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putSetupState,
    onSuccess: (data) => {
      queryClient.setQueryData(SETUP_STATE_QUERY_KEY, data);
    }
  });
}

export function useInferenceTest() {
  return useMutation({ mutationFn: (runs: number | undefined) => postInferenceTest(runs) });
}
