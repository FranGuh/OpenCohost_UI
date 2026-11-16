/**
 * Thin, test-friendly wrapper over the Rust supervisor commands the startup
 * gate needs. Outside Tauri (browser dev, vitest) every call degrades to a
 * "not available" result so the gate keeps its plain polling behaviour.
 */

export interface BackendStatus {
  managed: boolean;
  child_alive: boolean;
  /** The managed child died and the single automatic respawn is in flight. */
  restarting: boolean;
  /** The child died and the supervisor gave up: fail fast. */
  gave_up: boolean;
  restarts: number;
  error_code: string | null;
  log_path: string | null;
  last_line: string | null;
}

export type ReloadResult =
  | { ok: true }
  | { ok: false; unavailable: true }
  | { ok: false; unavailable?: false; code: string | null };

/** Closed set of codes `reload_backend_command` may reject with. Anything else
 * (raw errors, paths, tokens) is dropped before it can reach the UI. */
const SAFE_RELOAD_CODES = new Set([
  "backend_launch_failed",
  "backend_ports_busy",
  "backend_foreign_instance",
  "backend_exited",
  "backend_state_unavailable",
  "runtime_not_ready"
]);

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getBackendStatus(): Promise<BackendStatus | null> {
  if (!inTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<BackendStatus>("backend_status");
  } catch {
    return null;
  }
}

export async function reloadBackend(): Promise<ReloadResult> {
  if (!inTauri()) return { ok: false, unavailable: true };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("reload_backend_command");
    return { ok: true };
  } catch (error) {
    return { ok: false, code: typeof error === "string" && SAFE_RELOAD_CODES.has(error) ? error : null };
  }
}
