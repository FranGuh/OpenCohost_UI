import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.js";

interface DisclosureProps {
  label: string;
  children: ReactNode;
  className?: string;
}

/** Collapsed-by-default disclosure. Unlike ui/Collapsible the body is NOT
 * mounted while collapsed, so hidden controls cannot be reached or queried. */
export function Disclosure({ label, children, className }: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 self-start rounded text-[11px] font-semibold uppercase tracking-[0.09em] text-dim transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
      >
        <span
          aria-hidden="true"
          className={cn("text-xs transition-transform duration-base ease-io", !open && "-rotate-90")}
        >
          ▾
        </span>
        {label}
      </button>
      {open && <div id={bodyId}>{children}</div>}
    </div>
  );
}
