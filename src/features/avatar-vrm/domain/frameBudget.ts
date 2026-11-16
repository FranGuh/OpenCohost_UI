/** Frame pacing for the avatar rAF loop (pure; no DOM). */

/** rAF already paces to the display refresh (vsync); this caps high-refresh displays. */
const ACTIVE_FPS = 60;
const IDLE_FPS = 30;
/** rAF timestamps jitter around vsync; without slack a 60 Hz display drops 30 fps to ~20. */
const JITTER_MS = 2;

/** 30 fps when calm (idle/sleeping, no lip-sync audio); 60 fps otherwise. */
export function targetFps(state: string, audioActive = false): number {
  if (audioActive) return ACTIVE_FPS;
  return state === 'idle' || state === 'sleeping' ? IDLE_FPS : ACTIVE_FPS;
}

export function shouldRender(now: number, lastRender: number, fps: number): boolean {
  return now - lastRender >= 1000 / fps - JITTER_MS;
}
