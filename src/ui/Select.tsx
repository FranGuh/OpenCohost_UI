import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChangeEventHandler, SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// ─── Custom dropdown — rendered when `options` prop is provided ────────────

interface CustomProps {
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  className?: string;
}

function CustomSelect({ options, value, onChange, disabled, className, ...ariaProps }: CustomProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = options.find((o) => o.value === value);

  // The list is portaled to <body> (see below) so its stacking never depends
  // on an ancestor Card's backdrop-filter stacking context. Compute its
  // position from the trigger each time it opens; 4px replicates the inline
  // version's `mt-1` gap.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [open]);

  // Close when pointer lands outside the trigger AND outside the portaled list
  // (the list is no longer a DOM descendant of `ref`, so it needs its own check).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // A portaled element doesn't move with its trigger. Closing on scroll/resize
  // is simpler and cheaper than tracking position continuously — scroll fires
  // in the capture phase so it catches scrolling on any ancestor container,
  // not just the window.
  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
    }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-md border border-border bg-surface-2 px-3",
          "text-left text-sm font-semibold text-foreground transition-colors duration-fast ease-io",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          open && "border-ring"
        )}
        {...ariaProps}
      >
        <span>{selected?.label ?? value}</span>
        <span
          aria-hidden="true"
          className={cn("text-dim transition-transform duration-base ease-io", open && "rotate-180")}
        >
          ▾
        </span>
      </button>

      {/* Dropdown list — portaled to <body> so its stacking is theme- and
          ancestor-independent (see the useLayoutEffect above for positioning). */}
      {open &&
        position &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            style={{ position: "fixed", top: position.top, left: position.left, width: position.width }}
            className="z-50 overflow-hidden rounded-md border border-border bg-surface-2 py-1 shadow-panel"
          >
            {options.map((opt) => {
              const isSel = opt.value === value;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={opt.disabled}
                  onClick={() => {
                    if (!opt.disabled) { onChange(opt.value); setOpen(false); }
                  }}
                  className={cn(
                    "flex cursor-pointer items-center px-3 py-2.5 text-sm transition-colors duration-fast ease-io",
                    "hover:bg-accent-soft hover:text-primary",
                    isSel ? "bg-accent-soft font-semibold text-primary" : "text-foreground",
                    opt.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-foreground"
                  )}
                >
                  {opt.label}
                  {isSel && (
                    <span aria-hidden="true" className="ml-auto text-xs text-primary">
                      ✓
                    </span>
                  )}
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </div>
  );
}

// ─── Native <select> — backward compat for dynamic catalog call sites ──────

type NativeProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> & {
  /** Discriminant: absent on native variant. */
  options?: never;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
};

function NativeSelect({ className, children, ...props }: NativeProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-11 w-full appearance-none rounded-md border border-border bg-surface-2 px-3 pr-9 text-sm font-semibold text-foreground",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dim">
        ▾
      </span>
    </div>
  );
}

// ─── Public API ────────────────────────────────────────────────────────────

export type SelectProps = CustomProps | NativeProps;

/**
 * Token-styled select control. Two rendering modes:
 * - `options` prop → custom accessible dropdown (theme-aware; D9 upgrade for
 *   fixed option sets where native OS styling would look out-of-place).
 * - `children` → native <select> wrapper (backward compat for dynamic
 *   catalogs built from server data where the option set is not known ahead).
 */
export function Select(props: SelectProps) {
  if ("options" in props && Array.isArray(props.options)) {
    const { options, value, onChange, disabled, className, ...ariaProps } = props as CustomProps;
    return (
      <CustomSelect
        options={options}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={className}
        {...ariaProps}
      />
    );
  }
  return <NativeSelect {...(props as NativeProps)} />;
}
