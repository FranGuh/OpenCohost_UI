import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// ─── The dropdown — the only rendering mode (see the Select docstring) ─────

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

// Ceiling on the list's height so a long catalog (e.g. Agenda's 20-entry
// "attempts per topic" select) doesn't turn into a full-height wall — matches
// the max-h-96 ceiling MemoryCard already uses for its own scrollable list.
const LIST_MAX_HEIGHT_CEILING = 384;
const GAP = 4; // replicates the inline version's `mt-1` gap

interface ListPosition {
  left: number;
  width: number;
  maxHeight: number;
  /** Exactly one of top/bottom is set — bottom means "open upward". */
  top?: number;
  bottom?: number;
}

function CustomSelect({ options, value, onChange, disabled, className, ...ariaProps }: CustomProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState<ListPosition | null>(null);
  const selected = options.find((o) => o.value === value);

  // The list is portaled to <body> (see below) so its stacking never depends
  // on an ancestor Card's backdrop-filter stacking context. Compute its
  // position from the trigger each time it opens, sizing it to the actual
  // room available so a long list scrolls instead of running off-screen —
  // and opening upward when there is more room above than below, so a
  // trigger near the bottom of a panel doesn't get squeezed into a sliver.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;
    const { left, width } = rect;
    if (spaceBelow >= spaceAbove) {
      setPosition({ top: rect.bottom + GAP, left, width, maxHeight: Math.min(LIST_MAX_HEIGHT_CEILING, Math.max(spaceBelow, 0)) });
    } else {
      setPosition({
        bottom: window.innerHeight - rect.top + GAP,
        left,
        width,
        maxHeight: Math.min(LIST_MAX_HEIGHT_CEILING, Math.max(spaceAbove, 0))
      });
    }
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
            style={{
              position: "fixed",
              top: position.top,
              bottom: position.bottom,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight
            }}
            className="z-50 overflow-y-auto rounded-md border border-border bg-surface-2 py-1 shadow-panel"
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

// ─── Public API ────────────────────────────────────────────────────────────

export type SelectProps = CustomProps;

/**
 * Token-styled select control. Always renders the custom accessible dropdown
 * (theme-aware; D9 upgrade for fixed option sets where native OS styling
 * would look out-of-place).
 *
 * There used to be a second mode — pass `children` of `<option>` and get a
 * bare native `<select>` — kept as a "backward compat" escape hatch for call
 * sites with a dynamic catalog. In practice it was silent: nothing forced a
 * caller choosing that branch to notice it skipped the design system, and
 * three call sites did exactly that, shipping unstyled OS chrome by accident.
 * A union that lets a caller silently opt out of theming is a footgun, not a
 * feature, so the native branch was removed. Every call site now builds an
 * `options` array instead.
 */
export function Select({ options, value, onChange, disabled, className, ...ariaProps }: SelectProps) {
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
