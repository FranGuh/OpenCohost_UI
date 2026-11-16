export type GestureKind = "click" | "drag" | "cancel";

export const DRAG_THRESHOLD_PX = 6;

export function gestureKind(dx: number, dy: number, canceled: boolean): GestureKind {
  if (canceled) {
    return "cancel";
  }
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX ? "drag" : "click";
}
