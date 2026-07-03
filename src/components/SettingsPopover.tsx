import { useEffect, useRef, useState } from "react";
import { ThemeSwitcher } from "../theme/ThemeSwitcher.js";

/**
 * TopBar gear popover — relocates ThemeSwitcher off the top-level right
 * cluster into a minimal token-styled panel. Wave 1 extends this panel with
 * logs/compacto/help; keep the shell (open/close, aria-expanded,
 * click-outside/Esc) real now so those additions slot in without rework.
 */
export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Configuración"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="settings-popover-panel"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden="true">⚙</span>
      </button>

      {open && (
        <div id="settings-popover-panel" className="absolute right-0 top-11 z-10 flex flex-col gap-2 rounded-md border border-border-soft bg-card p-4 shadow-panel">
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Tema</span>
          <ThemeSwitcher />
        </div>
      )}
    </div>
  );
}
