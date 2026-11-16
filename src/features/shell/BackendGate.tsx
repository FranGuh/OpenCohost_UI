import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBaseUrl } from "../../api/client.js";
import { cn } from "../../lib/cn.js";
import { bootstrapBackend, resetBackendBootstrap, type BootstrapResult } from "../../lib/backendBootstrap.js";
import { getBackendStatus, reloadBackend, type BackendStatus } from "../../lib/backendControl.js";
import { getAppVersion } from "../../lib/appVersion.js";
import { BootLoader } from "../../ui/BootLoader.js";
import { useT } from "../../i18n/t.js";
import { SupportLinks } from "./SupportLinks.js";
import { buildFailureDetails, failureCauseKey, failureCode } from "./backendFailure.js";

const HEALTH_QUERY_KEY = ["backend-gate-health"] as const;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_FAILURE_THRESHOLD = 20;
// While the supervised child is still alive (a cold Python import plus model
// warm-up routinely outlasts 20 s) keep polling up to this many failures.
const DEFAULT_EXTENDED_FAILURE_THRESHOLD = 90;
const DEFAULT_HEALTH_TIMEOUT_MS = 2000;
// Fallback unmount for the splash fade — a hair over --dur-slow (320ms) so the
// overlay still tears down if `transitionend` never fires (jsdom, or a browser
// that drops the event). The visible fade is CSS-driven; this only guarantees
// teardown.
const SPLASH_FADE_MS = 360;
// Hard cap on waiting for the engine to settle, counted from the first health
// response with engine_alive. After it the gate proceeds anyway so a missing
// Ollama still reaches the setup wizard.
const DEFAULT_ENGINE_WAIT_CAP_MS = 90_000;

export type BootstrapPhase = "bootstrapping" | "probing" | "setup" | "ready" | "error";

function isApiHealth(value: unknown): value is { engine_alive: boolean } {
  if (typeof value !== "object" || value === null || !("engine_alive" in value) || typeof value.engine_alive !== "boolean") {
    return false;
  }
  // Preserve older live-engine responses, but never accept an explicit API
  // error. A dead engine needs affirmative API health to expose configuration.
  if ("status" in value) return value.status === "ok";
  return value.engine_alive;
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

export type HealthOutcome = "ready" | "loading";

function engineStateOf(body: { engine_alive: boolean }): unknown {
  return "engine_state" in body ? body.engine_state : undefined;
}

async function fetchHealth(
  querySignal: AbortSignal,
  timeoutMs: number,
  aliveSince: { current: number | null },
  engineWaitCapMs: number
): Promise<HealthOutcome> {
  const probeAbort = createHealthProbeAbort(querySignal, timeoutMs);
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/health`, {
      signal: probeAbort.signal
    });
    if (!res.ok) {
      throw new Error(`GET /api/health failed with ${res.status}`);
    }
    const body: unknown = await res.json();
    if (!isApiHealth(body)) {
      throw new Error("GET /api/health did not confirm API health");
    }
    // The API can configure Cloud even when inference is unavailable. Gate
    // readiness only mounts the app; engine/readiness APIs remain authoritative.
    if (!body.engine_alive) return "ready";
    aliveSince.current ??= Date.now();
    const state = engineStateOf(body);
    const settling = state === "starting" || state === "loading_model";
    if (settling && Date.now() - aliveSince.current < engineWaitCapMs) return "loading";
    return "ready";
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
  /** Failures tolerated while the managed child is still alive — defaults to 90. */
  extendedFailureThreshold?: number;
  /** Maximum time for one health fetch/body read; defaults to 2s. */
  healthTimeoutMs?: number;
  /** Max wait for engine_state to settle after the motor is alive; defaults to 90s. */
  engineWaitCapMs?: number;
  /** Explicit degraded bootstrap detail. `null` intentionally suppresses it. */
  backendError?: string | null;
}

/**
 * Owns the complete frontend startup state machine. React paints the
 * bootstrapping status first, this gate starts the module-singleton IPC work,
 * then it validates API availability before mounting its children. Live engines
 * get a bounded settling period; unavailable engines must still reach setup.
 */
export function BackendGate({
  children,
  runtimeSetup,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  extendedFailureThreshold = DEFAULT_EXTENDED_FAILURE_THRESHOLD,
  healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  engineWaitCapMs = DEFAULT_ENGINE_WAIT_CAP_MS,
  backendError
}: BackendGateProps) {
  const t = useT();
  const [phase, setPhase] = useState<BootstrapPhase>("bootstrapping");
  const [bootstrapEpoch, setBootstrapEpoch] = useState(0);
  const failureCount = useRef(0);
  const aliveSince = useRef<number | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(backendError ?? null);
  const [stillStarting, setStillStarting] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [retryCode, setRetryCode] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
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
    queryFn: ({ signal }) => fetchHealth(signal, healthTimeoutMs, aliveSince, engineWaitCapMs),
    enabled: phase === "probing",
    refetchInterval: phase === "probing" ? pollIntervalMs : false,
    retry: false
  });

  useEffect(() => {
    if (phase === "probing" && query.isSuccess && query.data === "ready") {
      setPhase("ready");
    }
  }, [phase, query.isSuccess, query.dataUpdatedAt]);

  useEffect(() => {
    if (phase !== "probing" || !query.isError) return;
    failureCount.current += 1;
    const count = failureCount.current;
    // Ask the supervisor whether the child is still coming up. Outside Tauri
    // there is no supervisor (null), which keeps the plain threshold behaviour.
    void getBackendStatus().then((status) => {
      if (status) setBackendStatus(status);
      const giveUp = () => setPhase((current) => (current === "probing" ? "error" : current));
      if (status?.gave_up) {
        giveUp();
        return;
      }
      if (count < failureThreshold) return;
      const waiting = status !== null && (status.child_alive || status.restarting);
      if (waiting && count < extendedFailureThreshold) {
        setStillStarting(true);
        return;
      }
      giveUp();
    });
  }, [extendedFailureThreshold, failureThreshold, query.errorUpdatedAt, query.isError]);

  // The error card quotes the log path and its last line: refresh the status
  // once when it opens (the poll-time snapshot can predate the final crash).
  useEffect(() => {
    if (phase !== "error") return;
    void getBackendStatus().then((status) => {
      if (status) setBackendStatus(status);
    });
  }, [phase]);

  const closing = phase === "ready";

  // Fallback teardown for the fade — see SPLASH_FADE_MS. `transitionend` on the
  // overlay is the primary path; this covers environments that never emit it.
  useEffect(() => {
    if (!closing || !splashOpen) return;
    const timer = setTimeout(() => setSplashOpen(false), SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [closing, splashOpen]);

  const copyDetails = useCallback(
    async (code: string) => {
      const text = buildFailureDetails({
        version: await getAppVersion(),
        code,
        restarts: backendStatus?.restarts ?? 0,
        logPath: backendStatus?.log_path ?? null,
        lastLine: backendStatus?.last_line ?? null
      });
      try {
        await navigator.clipboard.writeText(text);
        setCopyState("copied");
      } catch {
        // Clipboard can be blocked; say so instead of pretending it worked.
        setCopyState("failed");
      }
    },
    [backendStatus]
  );

  const retry = useCallback(async () => {
    setRetrying(true);
    setRetryCode(null);
    const result = await reloadBackend();
    setRetrying(false);
    failureCount.current = 0;
    setStillStarting(false);
    if (result.ok) {
      // A new child may be listening on a different port: redo the whole
      // bootstrap (IPC base URL + token) instead of just re-polling.
      resetBackendBootstrap();
      aliveSince.current = null;
      setBootstrapEpoch((epoch) => epoch + 1);
      setPhase("bootstrapping");
      return;
    }
    if (result.unavailable) {
      // No supervisor (browser/dev): re-poll like before.
      setPhase("probing");
      return;
    }
    setRetryCode(result.code);
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
    const code = failureCode(retryCode ?? backendStatus?.error_code ?? null);
    return (
      <div
        role="alert"
        className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-foreground"
      >
        <h1 className="mono text-2xl font-bold text-[var(--kira-cyan)]">OpenCohost</h1>
        <p className="text-sm text-muted-foreground">{t("shell.backendGate.error.message")}</p>
        {errorDetail ? <p className="text-xs text-muted-foreground">{t("shell.firstRun.error")}</p> : null}
        <p className="mono text-xs text-foreground">{t("shell.backendGate.error.code", { code })}</p>
        <p className="max-w-xl text-center text-xs text-muted-foreground">{t(failureCauseKey(code))}</p>
        {backendStatus?.log_path ? (
          <p className="mono max-w-xl break-all text-center text-[11px] text-muted-foreground">
            {t("shell.backendGate.error.log", { path: backendStatus.log_path })}
          </p>
        ) : null}
        {backendStatus?.last_line ? (
          <p className="mono max-w-xl break-all text-center text-[11px] text-muted-foreground">
            {t("shell.backendGate.error.lastLine", { line: backendStatus.last_line })}
          </p>
        ) : null}
        <button
          type="button"
          autoFocus
          disabled={retrying}
          onClick={() => void retry()}
          className="rounded-full border border-border-soft bg-card px-4 py-1.5 text-sm text-foreground hover:bg-[var(--accent-soft)]"
        >
          {t("shell.backendGate.retry.action")}
        </button>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void copyDetails(code)}
            className="rounded-full border border-border-soft px-3 py-1 text-xs text-foreground hover:bg-[var(--accent-soft)]"
          >
            {t("shell.backendGate.copy.action")}
          </button>
          <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {copyState === "copied" ? t("shell.backendGate.copy.done") : copyState === "failed" ? t("shell.backendGate.copy.failed") : ""}
          </span>
          <SupportLinks />
        </div>
        <p className="max-w-xl text-center text-[11px] text-muted-foreground">{t("shell.backendGate.copy.hint")}</p>
      </div>
    );
  }

  const statusCopy =
    phase === "bootstrapping"
      ? t("shell.backendGate.status.bootstrapping")
      : query.data === "loading"
        ? t("shell.backendGate.status.loadingModel")
        : stillStarting
          ? t("shell.backendGate.status.stillStarting")
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
