/**
 * Shell-side preferences, owned by the Tauri process so they are readable at
 * exit even when the backend is already gone (clean_shutdown_unload_20261007).
 * Outside Tauri (browser dev, vitest) there is no shell: reads fall back to
 * the default (unload ON) and writes are no-ops.
 */

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getUnloadModelsOnExit(): Promise<boolean> {
  if (!hasTauri()) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<boolean>("get_unload_models_on_exit")) !== false;
  } catch {
    return true;
  }
}

export async function setUnloadModelsOnExit(enabled: boolean): Promise<void> {
  if (!hasTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_unload_models_on_exit", { enabled });
  } catch {
    // Best-effort: the in-memory switch still reflects the click.
  }
}
