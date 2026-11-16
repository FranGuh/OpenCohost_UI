/**
 * The companion window is shown without activation so it never steals focus
 * from a game. The user's first click then activates it, and WebView2 can
 * deliver a `blur` during that activation. Without a guard that blur collapses
 * the composer the click just opened.
 */
export const BLUR_GRACE_MS = 600;

/**
 * @param now Timestamp of the blur event.
 * @param lastInteractionAt Timestamp of the latest pointer-down/open on the
 *   companion, or `null` when there has been none.
 */
export function shouldCollapseOnBlur(now: number, lastInteractionAt: number | null): boolean {
  if (lastInteractionAt === null) return true;
  return now - lastInteractionAt >= BLUR_GRACE_MS;
}
