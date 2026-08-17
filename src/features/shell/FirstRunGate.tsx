import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT, type TKey } from "../../i18n/t.js";

export type FirstRunPhase = "unconfigured" | "provisioning" | "ready" | "failed" | "degraded";

export interface FirstRunProgress {
  phase: string;
  completed: number;
  total: number;
  message: string;
}

export interface FirstRunStatus {
  phase: FirstRunPhase;
  launchable: boolean;
  data_root: string | null;
  default_data_root: string | null;
  install_id: string | null;
  error_code: string | null;
  message: string;
  can_retry: boolean;
  progress: FirstRunProgress | null;
}

interface FirstRunGateProps {
  onReady: () => void;
  backendError?: string | null;
}

const SAFE_MESSAGE_KEYS: Record<string, TKey> = {
  unconfigured: "shell.firstRun.message.unconfigured",
  runtime_unprovisioned: "shell.firstRun.message.unconfigured",
  invalid_handoff: "shell.firstRun.message.invalidHandoff",
  runtime_invalid: "shell.firstRun.message.invalidHandoff",
  data_root_inside_install: "shell.firstRun.message.installBoundary",
  runtime_not_ready: "shell.firstRun.message.runtimeNotReady",
  cancelled: "shell.firstRun.message.cancelled",
  deadline_exceeded: "shell.firstRun.message.deadline",
  download_failed: "shell.firstRun.message.downloadFailed",
  backend_launch_failed: "shell.firstRun.message.backendLaunch",
  cancellation_too_late: "shell.firstRun.message.cancellationTooLate",
  ipc_unavailable: "shell.firstRun.message.ipcUnavailable",
};

function safeIpcCode(value: unknown): string {
  return typeof value === "string" && (value in SAFE_MESSAGE_KEYS || value === "ipc_unavailable")
    ? value
    : "ipc_unavailable";
}

const SAFE_PHASE_KEYS: Record<string, TKey> = {
  unconfigured: "shell.firstRun.phase.unconfigured",
  provisioning: "shell.firstRun.phase.provisioning",
  ready: "shell.firstRun.phase.ready",
  failed: "shell.firstRun.phase.failed",
  degraded: "shell.firstRun.phase.degraded",
};

const SAFE_PROGRESS_KEYS: Record<string, TKey> = {
  verifybootstrap: "shell.firstRun.progress.verifyBootstrap",
  download: "shell.firstRun.progress.download",
  verifyhash: "shell.firstRun.progress.verifyHash",
  stage: "shell.firstRun.progress.stage",
  installpython: "shell.firstRun.progress.installPython",
  sync: "shell.firstRun.progress.sync",
  healthcheck: "shell.firstRun.progress.healthCheck",
  activate: "shell.firstRun.progress.activate",
  cleanup: "shell.firstRun.progress.cleanup",
};

function safePhase(value: string | undefined, translate: (key: TKey) => string): string {
  return translate(SAFE_PHASE_KEYS[value ?? ""] ?? "shell.firstRun.phase.unknown");
}

function safeProgressPhase(value: string | undefined, translate: (key: TKey) => string): string {
  const normalized = (value ?? "").replace(/_/g, "").toLowerCase();
  return translate(SAFE_PROGRESS_KEYS[normalized] ?? "shell.firstRun.progress.unknown");
}

function safeErrorCode(value: string | null | undefined, translate: (key: TKey) => string): string {
  if (!value) return translate("shell.firstRun.diagnostic.empty");
  const key = SAFE_MESSAGE_KEYS[value];
  return key ? translate(key) : translate("shell.firstRun.errorCode.unknown");
}

function safeMessage(value: Pick<FirstRunStatus, "phase" | "error_code">, translate: (key: TKey) => string): string {
  if (value.error_code && SAFE_MESSAGE_KEYS[value.error_code]) return translate(SAFE_MESSAGE_KEYS[value.error_code]);
  if (value.phase === "ready") return translate("shell.firstRun.message.ready");
  if (value.phase === "provisioning") return translate("shell.firstRun.message.provisioning");
  if (value.phase === "failed" || value.phase === "degraded") return translate("shell.firstRun.message.attention");
  return translate("shell.firstRun.message.unconfigured");
}

function ipcFailure(code: string): FirstRunStatus {
  return {
    phase: "degraded",
    launchable: false,
    data_root: null,
    default_data_root: null,
    install_id: null,
    error_code: code,
    message: code,
    can_retry: true,
    progress: null,
  };
}

export function FirstRunGate({ onReady, backendError = null }: FirstRunGateProps) {
  const t = useT();
  const [status, setStatus] = useState<FirstRunStatus | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userSelectedRoot = useRef(false);
  const operationStarted = useRef(false);
  const readyNotified = useRef(false);

  const refresh = useCallback(async (operation = false) => {
    try {
      const next = await invoke<FirstRunStatus>(operation ? "provision_status" : "first_run_status");
      const effective = backendError && next.phase === "ready"
        ? { ...next, phase: "degraded" as const, launchable: false, message: "backend_launch_failed", can_retry: true, error_code: "backend_launch_failed" }
        : next;
      setStatus(effective);
      if (!userSelectedRoot.current && (next.data_root || next.default_data_root)) {
        setSelectedRoot(next.data_root ?? next.default_data_root);
      }
      if (operation && next.phase === "ready" && !backendError && !readyNotified.current) {
        readyNotified.current = true;
        onReady();
      }
    } catch {
      setStatus({ ...ipcFailure("ipc_unavailable"), data_root: selectedRoot });
      if (operation) operationStarted.current = false;
    }
  }, [backendError, onReady, selectedRoot, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!operationStarted.current) return;
    const timer = window.setInterval(() => void refresh(true), 500);
    return () => window.clearInterval(timer);
  }, [refresh, status?.phase]);

  async function chooseFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, defaultPath: selectedRoot ?? undefined });
      if (typeof picked === "string") {
        userSelectedRoot.current = true;
        setSelectedRoot(picked);
      }
    } catch {
      // Outside Tauri or when the native picker is cancelled, keep the current selection.
    }
  }

  async function start() {
    const root = selectedRoot;
    if (!root) {
      await chooseFolder();
      return;
    }
    setBusy(true);
    operationStarted.current = true;
    readyNotified.current = false;
    try {
      await invoke("provision_start", { dataRoot: root });
      await refresh(true);
    } catch {
      operationStarted.current = false;
      setStatus(ipcFailure("ipc_unavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    if (backendError) {
      try {
        await invoke("reload_backend_command");
        onReady();
      } catch {
        setStatus(ipcFailure("backend_launch_failed"));
      } finally {
        setBusy(false);
      }
      return;
    }
    operationStarted.current = true;
    readyNotified.current = false;
    try {
      await invoke("provision_retry");
      await refresh(true);
    } catch {
      operationStarted.current = false;
      setStatus(ipcFailure("ipc_unavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    try {
      await invoke("provision_cancel");
      await refresh(true);
    } catch (error) {
      const code = safeIpcCode(error);
      if (code === "cancellation_too_late") {
        await refresh(true);
      } else {
        operationStarted.current = false;
        setStatus(ipcFailure(code));
      }
    } finally {
      setBusy(false);
    }
  }

  const progress = status?.progress;
  const determinate = progress && progress.total > 0;
  const percent = determinate ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;
  const localizedProgress = safeProgressPhase(progress?.phase, t);

  return (
    <main className="flex h-full min-h-0 w-full items-center justify-center overflow-auto bg-background px-6 py-8 text-foreground">
      <section className="w-full max-w-2xl rounded-[var(--r-lg)] border border-border-soft bg-card p-6 shadow-lg sm:p-8" aria-labelledby="first-run-title">
        <p className="mono text-[11px] uppercase tracking-[0.16em] text-[var(--kira-cyan)]">{t("shell.firstRun.eyebrow")}</p>
        <h1 id="first-run-title" className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{t("shell.firstRun.title")}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{t("shell.firstRun.description")}</p>

        <div className="mt-8 grid gap-4">
          <div className="rounded-[var(--r-md)] border border-border-soft bg-surface-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("shell.firstRun.storage.label")}</p>
            <p className="mono mt-2 break-all text-sm text-foreground">{selectedRoot ?? "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("shell.firstRun.storage.default")}</p>
            <button type="button" onClick={() => void chooseFolder()} className="mt-4 rounded-md border border-border-soft px-3 py-2 text-sm font-semibold hover:bg-[var(--accent-soft)]">
              {t("shell.firstRun.storage.choose")}
            </button>
          </div>

          <div className="rounded-[var(--r-md)] border border-border-soft bg-surface-2 p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("shell.firstRun.runtime.label")}</p>
              {status?.phase === "ready" ? <span className="text-xs text-[var(--ok)]">{t("shell.firstRun.runtime.ready")}</span> : null}
            </div>
            <p role="status" aria-live="polite" className="mt-3 text-sm text-foreground">{progress ? safeMessage({ phase: status?.phase ?? "provisioning", error_code: null }, t) : status ? safeMessage(status, t) : t("shell.firstRun.runtime.label")}</p>
            {progress ? (
              <div className="mt-4" aria-label={`${localizedProgress} ${percent}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? percent : undefined}>
                <div className="h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full bg-[var(--kira-cyan)] transition-[width] duration-base" style={{ width: determinate ? `${percent}%` : "35%" }} /></div>
                <p className="mono mt-2 text-[11px] text-muted-foreground">{localizedProgress}{determinate ? ` · ${percent}%` : ""}</p>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {status?.phase === "provisioning" ? (
                <button type="button" onClick={() => void cancel()} className="rounded-md border border-border-soft px-3 py-2 text-sm hover:bg-[var(--accent-soft)]">{t("shell.firstRun.runtime.cancel")}</button>
              ) : status?.phase === "failed" || status?.phase === "degraded" ? (
                <button type="button" disabled={busy} onClick={() => void retry()} className="rounded-md bg-[var(--kira-cyan)] px-3 py-2 text-sm font-semibold text-background disabled:opacity-60">{t("shell.firstRun.runtime.retry")}</button>
              ) : status?.phase !== "ready" ? (
                <button type="button" disabled={busy || !selectedRoot} onClick={() => void start()} className="rounded-md bg-[var(--kira-cyan)] px-3 py-2 text-sm font-semibold text-background disabled:opacity-60">{busy ? t("shell.firstRun.runtime.label") : t("shell.firstRun.runtime.install")}</button>
              ) : null}
            </div>
          </div>
        </div>

        <details className="mt-6 text-xs text-muted-foreground">
          <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t("shell.firstRun.diagnostics")}</summary>
          <dl className="mt-3 grid gap-2 rounded-md border border-border-soft bg-background p-3 sm:grid-cols-[auto_1fr]">
            <dt>{t("shell.firstRun.diagnostic.phase")}</dt><dd className="mono break-all">{status ? safePhase(status.phase, t) : t("shell.firstRun.diagnostic.loading")}</dd>
            <dt>{t("shell.firstRun.diagnostic.installId")}</dt><dd className="mono break-all">{status?.install_id ? t("shell.firstRun.diagnostic.configured") : t("shell.firstRun.diagnostic.empty")}</dd>
            <dt>{t("shell.firstRun.diagnostic.error")}</dt><dd className="mono break-all">{safeErrorCode(status?.error_code, t)}</dd>
          </dl>
        </details>
      </section>
    </main>
  );
}
