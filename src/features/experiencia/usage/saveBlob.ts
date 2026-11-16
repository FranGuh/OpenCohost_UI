/**
 * Saves a Blob through the webview's normal download flow (object URL plus a
 * temporary `<a download>`). The app has no Tauri fs/save plugin, and the
 * export is a small file the user explicitly confirmed.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke later: some webviews start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
