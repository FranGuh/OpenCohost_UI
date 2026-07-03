import { cn } from "../../lib/cn.js";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name — the mockup's switches have no visible label of their own. */
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

/** Token-styled toggle (mockup's `.switch[data-on]`) — hand-rolled, no radix. */
export function Switch({ checked, onChange, disabled, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[26px] w-[46px] shrink-0 rounded-full border border-border bg-card transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked && "border-transparent bg-[image:var(--accent-grad)]",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-[3px] top-[2px] h-5 w-5 rounded-full bg-muted-foreground transition-transform motion-reduce:transition-none",
          checked && "translate-x-5 bg-white"
        )}
      />
    </button>
  );
}
