import { bootstrapApiToken, setApiBaseUrl } from "../api/client.js";

/**
 * Response shape of the Rust `backend_info` command
 * (src-tauri/src/backend.rs::BackendInfo). Mirrors that struct manually —
 * there is no generated-types pipeline on the Tauri IPC boundary.
 */
export interface BackendInfo {
  base_url: string;
  managed: boolean;
  error?: BackendDiagnostic | null;
}

export interface BackendDiagnostic {
  code: string;
  stage: string;
  action: string;
  message_key: string;
}

export interface BootstrapResult {
  backendError: string | null;
  runtimeRequired?: boolean;
}

const BOOTSTRAP_TIMEOUT_MS = 2000;
const BACKEND_RESOLUTION_ERROR = "ipc_unavailable";
const SAFE_BACKEND_CODES = new Set([
  "runtime_not_ready",
  "backend_state_unavailable",
  "backend_launch_failed",
  "backend_ports_busy",
  "ipc_unavailable",
  "generic"
]);

let backendBootstrapError: string | null = null;
let bootstrapPromise: Promise<BootstrapResult> | null = null;

export function getBackendBootstrapError(): string | null {
  return backendBootstrapError;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("bootstrap deadline exceeded")), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeBackendInfo(value: BackendInfo): { baseUrl: string; error: string | null } | null {
  if (typeof value?.base_url !== "string") {
    return null;
  }

  try {
    const url = new URL(value.base_url.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
      return null;
    }
    return {
      baseUrl: url.toString().replace(/\/$/, ""),
      error:
        value.error &&
        typeof value.error.code === "string" &&
        typeof value.error.stage === "string" &&
        typeof value.error.action === "string" &&
        typeof value.error.message_key === "string"
          ? SAFE_BACKEND_CODES.has(value.error.code)
            ? value.error.code
            : "generic"
          : null
    };
  } catch {
    return null;
  }
}

function settleBootstrapOperations() {
  const backendInfoPromise = import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke<BackendInfo>("backend_info")
  );
  const tokenPromise = bootstrapApiToken();
  return Promise.allSettled([
    withTimeout(backendInfoPromise, BOOTSTRAP_TIMEOUT_MS),
    withTimeout(tokenPromise, BOOTSTRAP_TIMEOUT_MS)
  ]);
}

function resolveBackendResult(
  backendInfoResult: PromiseSettledResult<BackendInfo>
): BootstrapResult {
  if (backendInfoResult.status === "fulfilled") {
    const backendInfo = normalizeBackendInfo(backendInfoResult.value);
    if (backendInfo) {
      setApiBaseUrl(backendInfo.baseUrl);
      backendBootstrapError = backendInfo.error;
      return {
        backendError: backendBootstrapError,
        ...(backendBootstrapError && backendBootstrapError !== "backend_launch_failed"
          ? { runtimeRequired: true }
          : {})
      };
    }
  }

  // Keep the configured/default base URL. Do not surface response bodies or
  // thrown values in UI/log state; readiness polling owns the actionable retry.
  backendBootstrapError = BACKEND_RESOLUTION_ERROR;
  // eslint-disable-next-line no-console
  console.warn("backendBootstrap: backend_info unavailable; keeping the configured API base URL");
  return { backendError: backendBootstrapError };
}

async function runBootstrap(): Promise<BootstrapResult> {
  if (!("__TAURI_INTERNALS__" in window)) {
    backendBootstrapError = null;
    return { backendError: null };
  }

  const [backendInfoResult, tokenResult] = await settleBootstrapOperations();
  if (tokenResult.status === "rejected") {
    // eslint-disable-next-line no-console
    console.warn("backendBootstrap: api token bootstrap did not finish before the startup deadline");
  }
  return resolveBackendResult(backendInfoResult);
}

/**
 * Starts the two Tauri bootstrap commands once for the WebView lifetime.
 * Concurrent callers (including React StrictMode remounts) receive the exact
 * same promise, so each IPC command is invoked at most once.
 */
export function bootstrapBackend(): Promise<BootstrapResult> {
  bootstrapPromise ??= runBootstrap();
  return bootstrapPromise;
}

/** Allows the first-run controller to re-run the validated IPC bootstrap after
 * it atomically activates a runtime and reloads the backend child. */
export function resetBackendBootstrap(): void {
  bootstrapPromise = null;
}
