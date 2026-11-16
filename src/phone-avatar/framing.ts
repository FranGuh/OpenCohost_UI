/** Pure camera framing for a full-screen, video-call style portrait of the avatar. */

export interface CallFramingInput {
  /** World Y of the head bone. */
  headY: number;
  /** Canvas width / height. */
  aspect: number;
  /** Vertical field of view in degrees. */
  fovDeg: number;
}

const MIN_VISIBLE = 0.9; // metres of body shown at least: head to chest
const MAX_VISIBLE = 1.6; // never zoom out further than this
const MIN_WIDTH = 0.5; // metres of width needed to keep both shoulders in frame
const HEAD_FROM_TOP = 0.3; // head centre sits at this fraction from the top edge

export function callFraming({ headY, aspect, fovDeg }: CallFramingInput): { targetY: number; distance: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.5;
  const visible = Math.min(MAX_VISIBLE, Math.max(MIN_VISIBLE, MIN_WIDTH / a));
  const distance = visible / 2 / Math.tan((fovDeg * Math.PI) / 360);
  // Viewport centre is (0.5 - HEAD_FROM_TOP) * visible below the head.
  const targetY = headY - (0.5 - HEAD_FROM_TOP) * visible;
  return { targetY, distance };
}
