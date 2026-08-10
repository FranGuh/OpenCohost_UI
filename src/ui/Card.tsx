import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

/** Token-styled surface. `--surface-blur` is `none` on cockpit/studio and a
 * real backdrop blur on aurora (glassy) — applied via inline style since
 * Tailwind's static backdrop-blur-* scale can't reference a CSS var. */
export function Card({ className, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-md border border-border-soft bg-card text-card-foreground shadow-panel", className)}
      style={{ backdropFilter: "var(--surface-blur)", ...style }}
      {...props}
    />
  );
}
