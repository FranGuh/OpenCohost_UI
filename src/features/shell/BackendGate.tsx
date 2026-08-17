import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBaseUrl } from "../../api/client.js";
import { cn } from "../../lib/cn.js";
import { bootstrapBackend, resetBackendBootstrap, type BootstrapResult } from "../../lib/backendBootstrap.js";
import { BootLoader } from "../../ui/BootLoader.js";
import { useT } from "../../i18n/t.js";

const HEALTH_QUERY_KEY = ["backend-gate-health"] as const;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_FAILURE_THRESHOLD = 20;
const DEFAULT_HEALTH_TIMEOUT_MS = 2000;
// Fallback unmount for the splash fade — a hair over --dur-slow (320ms) so the
// overlay still tears down if `transitionend` never fires (jsdom, or a browser
// that drops the event). The visible fade is CSS-driven; this only guarantees
// teardown.
const SPLASH_FADE_MS = 360;

export type BootstrapPhase = "bootstrapping" | "probing" | "setup" | "ready" | "error";

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
  /** First-run/degraded runtime surface shown before health polling. */
  runtimeSetup?: (onReady: () => void, backendError: string | null) => ReactNode;
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
  runtimeSetup,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  backendError
}: BackendGateProps) {
  const t = useT();
  const [phase, setPhase] = useState<BootstrapPhase>("bootstrapping");
  const [bootstrapEpoch, setBootstrapEpoch] = useState(0);
  const failureCount = useRef(0);
  const [errorDetail, setErrorDetail] = useState<string | null>(backendError ?? null);
  // Splash lifetime, decoupled from `phase`: the app mounts the instant the gate
  // is ready while the boot splash stays as a fading overlay above it, then
  // unmounts. `phase` and the polling state machine are untouched by this.
  const [splashOpen, setSplashOpen] = useState(true);

  useEffect(() => {
    let active = true;
    void bootstrapBackend().then((result: BootstrapResult) => {
      if (!active) return;
      if (backendError === undefined) {
        setErrorDetail(result.backendError);
      }
      setPhase(result.runtimeRequired ? "setup" : "probing");
    });
    return () => {
      active = false;
    };
  }, [backendError, bootstrapEpoch]);

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

  const closing = phase === "ready";

  // Fallback teardown for the fade — see SPLASH_FADE_MS. `transitionend` on the
  // overlay is the primary path; this covers environments that never emit it.
  useEffect(() => {
    if (!closing || !splashOpen) return;
    const timer = setTimeout(() => setSplashOpen(false), SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [closing, splashOpen]);

  const retry = useCallback(() => {
    failureCount.current = 0;
    setPhase("probing");
  }, []);

  // Error branch: informative, unchanged — the state machine, retry, and copy
  // are exactly as before. The error card never carries the boot splash/collage.
  if (phase === "setup") {
    return runtimeSetup ? runtimeSetup(() => {
      resetBackendBootstrap();
      setBootstrapEpoch((epoch) => epoch + 1);
      setPhase("bootstrapping");
    }, errorDetail) : null;
  }

  if (phase === "error") {
    return (
      <div
        role="alert"
        className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-foreground"
      >
        <h1 className="mono text-2xl font-bold text-[var(--kira-cyan)]">OpenCohost</h1>
        <p className="text-sm text-muted-foreground">{t("shell.backendGate.error.message")}</p>
        {errorDetail ? <p className="text-xs text-muted-foreground">{t("shell.firstRun.error")}</p> : null}
        <button
          type="button"
          autoFocus
          onClick={retry}
          className="rounded-full border border-border-soft bg-card px-4 py-1.5 text-sm text-foreground hover:bg-[var(--accent-soft)]"
        >
          {t("shell.backendGate.retry.action")}
        </button>
      </div>
    );
  }

  const statusCopy =
    phase === "bootstrapping"
      ? t("shell.backendGate.status.bootstrapping")
      : t("shell.backendGate.status.probing");

  // Ready mounts the app immediately; the splash stays as a full-viewport
  // overlay above it, fades opacity 1→0 (--dur-slow), then unmounts on the
  // overlay's own transitionend (or the SPLASH_FADE_MS fallback). Guarding on
  // `event.target === event.currentTarget` ignores the collage tiles' own
  // opacity transitions bubbling up.
  return (
    <>
      {phase === "ready" && children}
      {splashOpen && (
        <div
          aria-hidden={closing || undefined}
          onTransitionEnd={(event) => {
            if (closing && event.target === event.currentTarget) setSplashOpen(false);
          }}
          className={cn(
            "absolute inset-0 z-50 transition-opacity duration-slow ease-out",
            closing ? "pointer-events-none opacity-0" : "opacity-100"
          )}
        >
          <BootLoader statusLabel={statusCopy} />
        </div>
      )}
    </>
  );
}
