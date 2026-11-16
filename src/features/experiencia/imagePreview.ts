/**
 * In-memory previews of a pasted image (owner decision 2026-11-10: the image the
 * owner sends is shown in the conversation). A preview is an object URL when the
 * platform can make one, otherwise the data URL of the same bytes. It lives only
 * in front-end state for the session: never persisted, never sent anywhere but
 * the existing image-turn request.
 */
export function createPreviewUrl(file: Blob, dataUrl: string): string {
  try {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(file);
    }
  } catch {
    // fall through to the data URL
  }
  return dataUrl;
}

/** Releases an object URL. A data URL holds nothing to release. */
export function revokePreviewUrl(url: string | undefined): void {
  if (!url || !url.startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // nothing to release
  }
}
