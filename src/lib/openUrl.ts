/**
 * Opens an external HTTP/HTTPS URL in the user's default OS browser.
 *
 * Inside Tauri: calls the native Rust command `open_external_url`.
 * Outside Tauri (e.g. browser dev mode, vitest): falls back to `window.open`.
 */

export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (hasTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url });
      return true;
    } catch {
      // In case invoke fails, proceed to window.open fallback
    }
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noreferrer");
    return true;
  }

  return false;
}
