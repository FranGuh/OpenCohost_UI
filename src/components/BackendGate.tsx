import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBaseUrl } from "../api/client.js";
import { getBackendBootstrapError } from "../lib/backendBootstrap.js";

const HEALTH_QUERY_KEY = ["backend-gate-health"] as const;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_FAILURE_THRESHOLD = 20;

async function fetchHealth(): Promise<true> {
  const res = await fetch(`${getApiBaseUrl()}/api/health`);
  if (!res.ok) {
    throw new Error(`GET /api/health failed with ${res.status}`);
  }
  return true;
}

export interface BackendGateProps {
  children: ReactNode;
  /** Poll interval in ms — overridable for tests, defaults to 1s. */
  pollIntervalMs?: number;
  /** Consecutive failures before showing the error copy — defaults to 20 (~20s at the default interval). */
  failureThreshold?: number;
  /**
   * Detail string to show under the generic error copy — defaults to
   * `getBackendBootstrapError()` (the Rust-reported degraded-spawn detail,
   * if any). Overridable as a prop for tests.
   */
  backendError?: string | null;
}

/**
 * Boot gate for the managed-backend flow (WU-E): polls GET /api/health every
 * `pollIntervalMs` and blocks rendering the real app behind a splash until
 * the FIRST 200 response lands. Mounted-once semantics — once healthy, the
 * poll is disabled for good (`enabled: !healthy` below) and this component
 * never re-blocks the UI again, even if the backend later dies. Per-panel
 * error states (existing ApiError handling) own that case, not this gate.
 */
export function BackendGate({
  children,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  backendError = getBackendBootstrapError()
}: BackendGateProps) {
  const [healthy, setHealthy] = useState(false);
  const [failureCount, setFailureCount] = useState(0);

  const query = useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: fetchHealth,
    enabled: !healthy,
    refetchInterval: healthy ? false : pollIntervalMs,
    retry: false
  });

  useEffect(() => {
    if (query.isSuccess) {
      setHealthy(true);
    }
  }, [query.isSuccess, query.dataUpdatedAt]);

  useEffect(() => {
    if (query.isError) {
      setFailureCount((count) => count + 1);
    }
  }, [query.isError, query.errorUpdatedAt]);

  const retry = useCallback(() => {
    setFailureCount(0);
    void query.refetch();
  }, [query]);

  if (healthy) {
    return <>{children}</>;
  }

  const timedOut = failureCount >= failureThreshold;

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="mono text-2xl font-bold text-[var(--kira-cyan)]">OpenCohost</h1>
      {timedOut ? (
        <>
          <p className="text-sm text-muted-foreground">No se pudo conectar con el motor local.</p>
          {backendError ? (
            <p className="text-xs text-muted-foreground">Detalle: {backendError}</p>
          ) : null}
          <button
            type="button"
            onClick={retry}
            className="rounded-full border border-border-soft bg-card px-4 py-1.5 text-sm text-foreground hover:bg-[var(--accent-soft)]"
          >
            Reintentar
          </button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Iniciando motor local…</p>
      )}
    </div>
  );
}
