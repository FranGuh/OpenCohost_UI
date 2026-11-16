import { hasTauri } from "./openUrl.js";

/** The packaged app version, or null outside Tauri / when it cannot be read. */
export async function getAppVersion(): Promise<string | null> {
  if (!hasTauri()) return null;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}
