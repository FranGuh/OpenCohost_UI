import { bootstrapApiToken, setApiBaseUrl } from "../api/client.js";

/**
 * Response shape of the Rust `backend_info` command
 * (src-tauri/src/backend.rs::BackendInfo). Mirrors that struct manually —
 * there is no generated-types pipeline on the Tauri IPC boundary.
 * ponytail: keep in sync manually.
 */
export interface BackendInfo {
  base_url: string;
  managed: boolean;
  /**
   * Populated on any degraded resolution path (spawn IO error, spawned
   * process exited immediately, both primary and fallback ports busy) —
   * `null`/`undefined` on the healthy/managed-success paths.
   */
  error?: string | null;
}

let backendBootstrapError: string | null = null;

/**
 * Detail string captured from the last `backend_info` invoke, if the Rust
 * side reported a degraded resolution (see `BackendInfo.error` above).
 * Read by `BackendGate`'s error copy so the user sees the concrete failure
 * instead of just a generic "couldn't reach the local engine" message.
 */
export function getBackendBootstrapError(): string | null {
  return backendBootstrapError;
}

const BOOTSTRAP_TIMEOUT_MS = 2000;

/**
 * Races `promise` against a timeout — used so a never-settling Tauri IPC
 * call can't block first paint indefinitely. Rejects on timeout; the
 * caller's existing catch-and-keep-defaults handling takes it from there.
 * The dangling timer is harmless (module-scoped, app-lifetime process) but
 * cleared on the happy path for tidiness.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Detects the Tauri v2 webview runtime (`"__TAURI_INTERNALS__" in window`)
 * and, if present, asks the Rust shell for the resolved backend base URL —
 * the real port is only known after Rust spawns (or finds) the Python
 * backend, so a packaged build has no `.env.local` to bake
 * `VITE_API_BASE_URL` into the bundle at build time.
 *
 * In plain browser dev (`pnpm dev` outside the Tauri shell) this is a
 * no-op: `getApiBaseUrl()`'s default (DEFAULT_API_BASE_URL, or
 * VITE_API_BASE_URL if set) stays in effect.
 *
 * Never throws and never delays rendering on failure — a missing/broken
 * `backend_info` command just leaves the default API base URL in place,
 * same as running outside Tauri.
 */
export async function bootstrapBackend(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await withTimeout(invoke<BackendInfo>("backend_info"), BOOTSTRAP_TIMEOUT_MS);
    setApiBaseUrl(info.base_url);
    backendBootstrapError = info.error ?? null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("backendBootstrap: backend_info invoke failed, keeping default API base URL", error);
  }

  // Operator token handoff (agent_context_gateway Phase 4, ADR-5) — independent
  // of backend_info's outcome above, so a degraded/timed-out backend_info must
  // not block warming the token cache. Never throws (see client.ts), but the
  // underlying `api_token` invoke's retry loop can take up to ~1.2s (or hang
  // on a broken IPC boundary) — wrapped in the same timeout budget as
  // backend_info above so a stuck invoke can't block first paint.
  try {
    await withTimeout(bootstrapApiToken(), BOOTSTRAP_TIMEOUT_MS);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("backendBootstrap: bootstrapApiToken timed out, continuing without a token", error);
  }
}
