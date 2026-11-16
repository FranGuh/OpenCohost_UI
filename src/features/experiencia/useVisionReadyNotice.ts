import { useEffect, useRef } from "react";
import { emitAppEvent } from "../../lib/appEvents.js";
import type { VisionComposerState } from "../../api/vision.js";

/**
 * Tells the owner, once, when vision goes from starting to ready. It rides on
 * the status poll the composer already runs (no extra request), goes through the
 * app's existing event + toast pipeline, and fires on the transition only: a
 * later poll that still says ready, or a first load that already says ready,
 * stays silent.
 */
export function useVisionReadyNotice(phase: VisionComposerState["phase"]): void {
  const previous = useRef(phase);
  useEffect(() => {
    if (previous.current === "starting" && phase === "ready") {
      emitAppEvent({ source: "vision", action: "ready", tone: "ok" });
    }
    previous.current = phase;
  }, [phase]);
}
