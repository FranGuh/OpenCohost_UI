/**
 * Native open-file dialog (Tauri's `dialog` plugin), returning the picked
 * ABSOLUTE path.
 *
 * Why a native dialog and not `<input type="file">`: the webview hands back a
 * sandboxed `File` whose `.path` does not exist, but every endpoint that
 * consumes a file here takes a server-side absolute path instead of a
 * multipart body — `POST /api/music/import` (`body.path`, rejected with
 * `path must be absolute`) and `PUT /api/avatar/config` (`state_images`, a
 * plain path map). Client and server share a filesystem (local-first
 * product), so the OS picker is the whole missing link; no upload endpoint is
 * needed.
 *
 * Returns `null` for BOTH "user cancelled" and "no native picker available"
 * (plain `vite dev` in a browser tab, vitest/jsdom — the IPC call throws
 * without `__TAURI_INTERNALS__`). Callers treat `null` as "no file chosen"
 * and do nothing, so a cancel is never surfaced as an error. Same
 * swallow-outside-Tauri contract as TitleBar's window controls.
 *
 * ponytail: desktop only. On mobile the plugin can return a content URI
 * rather than a filesystem path — irrelevant here (Tauri desktop shell), and
 * the backend would reject it as non-absolute anyway rather than misbehave.
 */
export async function pickFile(filter: { name: string; extensions: string[] }): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, directory: false, filters: [filter] });
    // `multiple: false` resolves to `string | null`; the typeof guard also
    // makes an unexpected array shape a no-op instead of a bad request body.
    return typeof picked === "string" ? picked : null;
  } catch {
    // ponytail: outside Tauri there is no picker; same as a cancel.
    return null;
  }
}
