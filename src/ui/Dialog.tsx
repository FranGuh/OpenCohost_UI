import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import { cn } from "../lib/cn.js";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Header, body, footer — everything inside the dialog. Dialog owns only
   * the modal shell, never the content. */
  children: ReactNode;
  /** Id of the element (usually the title) that labels the dialog. */
  ariaLabelledBy?: string;
  /** Use instead of `ariaLabelledBy` when there is no visible heading to
   * point at. */
  ariaLabel?: string;
  /** Element focused once the dialog opens. Defaults to the dialog container
   * itself when omitted (e.g. a read-only dialog with no natural first
   * field). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Merged onto the dialog wrapper via twMerge — override to resize; the
   * default reproduces ProfileEditor's original comfortable-width dialog. */
  className?: string;
}

const DEFAULT_DIALOG_CLASS = "relative flex max-h-[85vh] w-[44rem] max-w-[92vw] overflow-hidden rounded-xl";

/**
 * Generic modal shell — extracted from ProfileEditor, the first (and most
 * complete) of four hand-rolled `role="dialog"` implementations that had
 * accumulated in this codebase. Owns the backdrop, focus trap, Escape-to-
 * close, and focus in/out; callers own everything inside (title, close
 * button, body). Portals to `document.body`: `Card` makes itself a
 * containing block for `position: fixed` descendants whenever
 * `backdrop-filter` is non-`none` (aurora theme), and every mount here is
 * inside a Card — without the portal, the `fixed inset-0` overlay
 * positions against the card instead of the viewport. Same trap `Select`
 * hit and fixed the same way (`40f7537`). The focus trap and focus restore
 * below are ref- and document-listener based, so relocating the DOM node
 * doesn't affect them.
 *
 * ComposerCommandPanel, WelcomeCard, and StatusRail still hand-roll their own
 * dialog and were deliberately left alone — not yet audited against this
 * API, not a redesign target of this change.
 */
export function Dialog({
  open,
  onClose,
  children,
  ariaLabelledBy,
  ariaLabel,
  initialFocusRef,
  className
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // On open: remember the trigger, then move focus into the dialog. On
  // close: restore focus to the trigger (WCAG 2.4.3).
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    (initialFocusRef?.current ?? dialogRef.current)?.focus();
    return () => triggerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Trap Tab within the dialog while open (aria-modal only hides the
  // background from AT; it does not stop keyboard focus escaping).
  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className={cn(DEFAULT_DIALOG_CLASS, className)}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
