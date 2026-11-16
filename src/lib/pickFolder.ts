/**
 * Native choose-folder dialog (Tauri `dialog` plugin, `dialog:allow-open`),
 * the same call `FirstRunGate` uses for the data folder.
 *
 * Returns the picked ABSOLUTE path, or `null` for both "cancelled" and "no
 * native picker available" (plain browser dev, vitest). Callers treat `null`
 * as "nothing chosen" and do nothing.
 */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, defaultPath });
    return typeof picked === "string" ? picked : null;
  } catch {
    return null;
  }
}
