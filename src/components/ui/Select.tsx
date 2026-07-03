import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Token-styled native <select> (mockup's `.select` treatment). Design D9
 * (native platform control, no combobox/radix) still holds — this only fixes
 * the styling, not the semantics: a real <select> keeps native keyboard/
 * screen-reader behavior for free. `appearance-none` hides the native arrow
 * so the decorative chevron replaces it without doubling up.
 */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-11 w-full appearance-none rounded-md border border-border bg-background px-3 pr-9 text-sm font-semibold text-foreground",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dim"
      >
        ▾
      </span>
    </div>
  );
}
