import { Loader2 } from "lucide-react";
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
  /** Id of an element describing the group (e.g. a hint line). */
  ariaDescribedBy?: string;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}

/** Pill segmented control — same treatment as ThemeSwitcher, generalized. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  ariaDescribedBy,
  disabled,
  pending = false,
  className
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={cn("inline-flex w-fit max-w-full flex-wrap gap-[3px] rounded-full border border-border bg-card p-1 shadow-soft", className)}
    >
      {options.map((option) => {
        const selected = value === option.value;
        const showSpinner = pending && selected;
        return (
          <Button
            key={option.value}
            type="button"
            variant={selected ? "primary" : "ghost"}
            aria-pressed={selected}
            aria-busy={showSpinner || undefined}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-8 rounded-full px-3 text-[13px] disabled:cursor-not-allowed",
              selected ? "disabled:opacity-90" : "disabled:opacity-50"
            )}
          >
            {showSpinner && (
              <Loader2 size={13} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
