import { cn } from "../../lib/cn.js";

export interface BrandMarkProps {
  size?: number;
  className?: string;
  /** Set true when a visible "OpenCohost" wordmark sits right next to this
   * mark (e.g. TopBar lockup) — avoids the label being announced twice. */
  "aria-hidden"?: boolean;
}

/**
 * The OpenCohost logo lockup: a ring (the focus-ring / aperture motif) with
 * Kira's round cyan face at top-right. Colors resolve from tokens so it
 * themes with cockpit/aurora/studio — no hardcoded hex here.
 */
export function BrandMark({ size = 32, className, "aria-hidden": ariaHidden }: BrandMarkProps) {
  return (
    <svg
      role="img"
      aria-label={ariaHidden ? undefined : "OpenCohost"}
      aria-hidden={ariaHidden}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    >
      <g className="text-foreground">
        <circle cx={50} cy={66} r={34} stroke="currentColor" strokeWidth={15} fill="none" />
      </g>
      <g>
        <circle cx={90} cy={34} r={20} className="fill-accent2" stroke="var(--void)" strokeWidth={3} />
        <rect x={83} y={27} width={6} height={12} rx={3} className="fill-foreground" />
        <rect x={93} y={27} width={6} height={12} rx={3} className="fill-foreground" />
        <rect x={87} y={41} width={5} height={5} rx={2.5} className="fill-foreground" />
      </g>
    </svg>
  );
}
