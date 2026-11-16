import { useEffect, useRef } from "react";
import { revokePreviewUrl } from "./imagePreview.js";

/**
 * Releases pasted-image preview URLs. Pass every URL still referenced by state
 * (the composer attachment and the conversation turns): one that stops being
 * referenced is revoked on the next commit, and all of them are revoked when
 * the component unmounts. Nothing here persists or transmits an image.
 */
export function usePreviewUrlGc(inUse: ReadonlySet<string>): void {
  const known = useRef(new Set<string>());

  useEffect(() => {
    for (const url of inUse) known.current.add(url);
    for (const url of Array.from(known.current)) {
      if (!inUse.has(url)) {
        revokePreviewUrl(url);
        known.current.delete(url);
      }
    }
  }, [inUse]);

  useEffect(() => {
    const urls = known.current;
    return () => {
      for (const url of urls) revokePreviewUrl(url);
      urls.clear();
    };
  }, []);
}
