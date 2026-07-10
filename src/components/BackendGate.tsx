import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBaseUrl } from "../api/client.js";
import { bootstrapBackend, type BootstrapResult } from "../lib/backendBootstrap.js";

const HEALTH_QUERY_KEY = ["backend-gate-health"] as const;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_FAILURE_THRESHOLD = 20;
const DEFAULT_HEALTH_TIMEOUT_MS = 2000;

export type BootstrapPhase = "bootstrapping" | "probing" | "ready" | "error";

function isReadyHealth(value: unknown): value is { engine_alive: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "engine_alive" in value &&
    value.engine_alive === true
  );
}

function createHealthProbeAbort(querySignal: AbortSignal, timeoutMs: number) {
  const requestController = new AbortController();
  const abortFromQuery = () => requestController.abort(querySignal.reason);
  const timeout = setTimeout(() => requestController.abort(), timeoutMs);

  if (querySignal.aborted) {
    abortFromQuery();
  } else {
    querySignal.addEventListener("abort", abortFromQuery, { once: true });
  }

  return {
    signal: requestController.signal,
    cleanup() {
      clearTimeout(timeout);
      querySignal.removeEventListener("abort", abortFromQuery);
    }
  };
}

async function fetchHealth(querySignal: AbortSignal, timeoutMs: number): Promise<true> {
  const probeAbort = createHealthProbeAbort(querySignal, timeoutMs);
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/health`, {
      signal: probeAbort.signal
    });
    if (!res.ok) {
      throw new Error(`GET /api/health failed with ${res.status}`);
    }
    const body: unknown = await res.json();
    if (!isReadyHealth(body)) {
      throw new Error("GET /api/health did not confirm engine readiness");
    }
    return true;
  } finally {
    probeAbort.cleanup();
  }
}

export interface BackendGateProps {
  children: ReactNode;
  /** Poll interval in ms — overridable for tests, defaults to 1s. */
  pollIntervalMs?: number;
  /** Consecutive failures before showing the error copy — defaults to 20. */
  failureThreshold?: number;
  /** Maximum time for one health fetch/body read; defaults to 2s. */
  healthTimeoutMs?: number;
  /** Explicit degraded bootstrap detail. `null` intentionally suppresses it. */
  backendError?: string | null;
}

/**
 * Owns the complete frontend startup state machine. React paints the
 * bootstrapping status first, this gate starts the module-singleton IPC work,
 * then it polls validated engine readiness before mounting its children.
 */
export function BackendGate({
  children,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  backendError
}: BackendGateProps) {
  const [phase, setPhase] = useState<BootstrapPhase>("bootstrapping");
  const failureCount = useRef(0);
  const [errorDetail, setErrorDetail] = useState<string | null>(backendError ?? null);

  useEffect(() => {
    let active = true;
    void bootstrapBackend().then((result: BootstrapResult) => {
      if (!active) return;
      if (backendError === undefined) {
        setErrorDetail(result.backendError);
      }
      setPhase("probing");
    });
    return () => {
      active = false;
    };
  }, [backendError]);

  const query = useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: ({ signal }) => fetchHealth(signal, healthTimeoutMs),
    enabled: phase === "probing",
    refetchInterval: phase === "probing" ? pollIntervalMs : false,
    retry: false
  });

  useEffect(() => {
    if (phase === "probing" && query.isSuccess) {
      setPhase("ready");
    }
  }, [phase, query.isSuccess, query.dataUpdatedAt]);

  useEffect(() => {
    if (phase !== "probing" || !query.isError) return;
    failureCount.current += 1;
    if (failureCount.current >= failureThreshold) {
      setPhase("error");
    }
  }, [failureThreshold, query.errorUpdatedAt, query.isError]);

  const retry = useCallback(() => {
    failureCount.current = 0;
    setPhase("probing");
  }, []);

  if (phase === "ready") {
    return <>{children}</>;
  }

  const isError = phase === "error";
  const statusCopy =
    phase === "bootstrapping" ? "Preparando motor local…" : "Comprobando motor local…";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
      aria-busy={isError ? undefined : true}
      className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-foreground"
    >
      <h1 className="mono text-2xl font-bold text-[var(--kira-cyan)]">OpenCohost</h1>
      {isError ? (
        <>
          <p className="text-sm text-muted-foreground">No se pudo conectar con el motor local.</p>
          {errorDetail ? (
            <p className="text-xs text-muted-foreground">Detalle: {errorDetail}</p>
          ) : null}
          <button
            type="button"
            autoFocus
            onClick={retry}
            className="rounded-full border border-border-soft bg-card px-4 py-1.5 text-sm text-foreground hover:bg-[var(--accent-soft)]"
          >
            Reintentar
          </button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{statusCopy}</p>
      )}
    </div>
  );
}
