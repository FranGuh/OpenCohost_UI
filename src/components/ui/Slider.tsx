import { cn } from "../../lib/cn.js";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Accessible name — mirrors Switch.tsx's required aria-label contract. */
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

/**
 * Token-styled wrapper over the native `<input type="range">` — same
 * no-radix, hand-rolled language as Switch.tsx: plain native element,
 * token classes only, no headless-UI dependency.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  className,
  ...aria
}: SliderProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={aria["aria-label"]}
      onChange={(event) => onChange(Number(event.target.value))}
      className={cn(
        "h-1 w-full shrink-0 cursor-pointer appearance-none rounded-full bg-surface-2 accent-[var(--accent)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
    />
  );
}
