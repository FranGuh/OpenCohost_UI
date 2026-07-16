import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional node rendered inside the input wrapper, trailing the field. */
  trailing?: ReactNode;
  /** Wrapper className — applied to the outer container when `trailing` is used. */
  wrapperClassName?: string;
}

/**
 * Text input that follows the project token system.
 *
 * Without `trailing`: renders a plain <input> that can be placed in any
 * layout (grid, flex, etc.) and sized with `className`.
 *
 * With `trailing`: wraps the <input> + slot in a flex container so the slot
 * (e.g. an icon button) sits inside the visible field boundary.
 */
export function Input({
  trailing,
  className,
  wrapperClassName,
  ...props
}: InputProps) {
  const fieldClasses = cn(
    "h-11 w-full rounded-md border border-[var(--border)] bg-[var(--background)]",
    "px-3 text-sm text-[var(--foreground)] placeholder:text-[var(--dim)]",
    "transition-colors duration-fast ease-io",
    "disabled:cursor-not-allowed disabled:opacity-60",
    // Focus ring — same contract as Button / Select
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
    // When nested inside a wrapper hide the right border-radius so it flows
    // into the trailing slot seamlessly
    trailing && "rounded-r-none border-r-0",
    className
  );

  if (!trailing) {
    return <input {...props} className={fieldClasses} />;
  }

  return (
    <div
      className={cn(
        "flex items-stretch overflow-hidden rounded-md border border-[var(--border)]",
        "bg-[var(--background)] transition-colors duration-fast ease-io",
        // Propagate focus-within ring so the whole compound field lights up
        "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring)]",
        wrapperClassName
      )}
    >
      <input {...props} className={fieldClasses} />
      {trailing}
    </div>
  );
}