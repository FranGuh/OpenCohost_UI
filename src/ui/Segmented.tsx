import { Button } from "./Button.js";
import { cn } from "../lib/cn.js";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  /** `null` means no option maps to the current external value — nothing is marked pressed. */
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

/** Pill segmented control — same treatment as ThemeSwitcher, generalized. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  className
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex flex-wrap gap-[3px] rounded-full border border-border bg-card p-1 shadow-soft", className)}
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={value === option.value ? "primary" : "ghost"}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className="h-8 rounded-full px-3 text-[13px]"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
