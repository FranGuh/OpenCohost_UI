import { cn } from "../lib/cn.js";

export interface KiraFaceProps {
  size?: number;
  className?: string;
  /** Set true when a nearby label already names Kira (e.g. the KIRA turn
   * badge, the empty-state title) so the mark isn't announced twice. */
  "aria-hidden"?: boolean;
}

/**
 * Kira's round face as a standalone avatar — the SAME geometry as the face in
 * BrandMark (cyan circle + two eye rects + mouth rect), so the brand mark and
 * the chat speaker read as one character with zero new assets. Colors resolve
 * from tokens (themes across cockpit/aurora/studio); the eyes/mouth use
 * --background so they stay legible on the accent circle in every theme.
 */
export function KiraFace({ size = 22, className, "aria-hidden": ariaHidden }: KiraFaceProps) {
  return (
    <svg
      role="img"
      aria-label={ariaHidden ? undefined : "Kira"}
      aria-hidden={ariaHidden}
      viewBox="66 10 48 48"
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full", className)}
    >
      <circle cx={90} cy={34} r={20} className="fill-accent2" />
      <rect x={83} y={27} width={6} height={12} rx={3} fill="var(--background)" />
      <rect x={93} y={27} width={6} height={12} rx={3} fill="var(--background)" />
      <rect x={87} y={41} width={5} height={5} rx={2.5} fill="var(--background)" />
    </svg>
  );
}
