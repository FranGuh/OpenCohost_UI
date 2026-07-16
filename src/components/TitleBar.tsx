import type { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { BrandMark } from "./ui/BrandMark.js";

type WindowAction = "minimize" | "toggleMaximize" | "close";

// The controls only drive a real window inside the Tauri webview. In the plain
// vite dev server and in vitest (jsdom) the module import resolves, but the IPC
// call throws without __TAURI_INTERNALS__ — swallow it so nothing crashes.
async function runWindowAction(action: WindowAction): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[action]();
  } catch {
    // ponytail: outside Tauri there is no window to drive; no-op.
  }
}

interface WindowButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  variant?: "ghost" | "danger";
}

function WindowButton({ label, icon, onClick, variant = "ghost" }: WindowButtonProps) {
  const hover =
    variant === "danger"
      ? "hover:bg-danger-bg hover:text-danger"
      : "hover:bg-surface-2 hover:text-foreground";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-full w-12 items-center justify-center text-muted-foreground transition-colors ${hover}`}
    >
      {icon}
    </button>
  );
}

/** Portal target id for the app-side cluster (StatusRail + SettingsPopover).
 * AppLayout (which lives past the BackendGate) portals its controls in here, so
 * they appear only once the app is ready — during boot the slot stays empty and
 * the bar shows brand + window buttons only. */
export const TITLEBAR_APP_CONTROLS_SLOT_ID = "oc-titlebar-app-controls";

/**
 * The single merged window bar for the frameless (decorations:false) Tauri
 * window: brand lockup + tagline/credit on the left, the app-controls slot and
 * the three caption buttons on the right. The bar background (and the flex
 * spacer) carry `data-tauri-drag-region` — in Tauri v2 dragging fires ONLY on
 * the element under the pointer that carries the attribute, so every interactive
 * child (credit link, status chips, gear, caption buttons) keeps working without
 * an explicit opt-out. The brand statics are `pointer-events-none` so a mousedown
 * on the logo/wordmark falls through to the drag region; the credit link
 * re-enables pointer events so it stays clickable. Double-click-to-maximize is
 * left to Tauri's native drag-region handling (no JS handler). Colors resolve
 * from theme tokens, so the bar re-skins with the app.
 */
export function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 select-none items-center gap-3 border-b border-border-soft bg-card pl-3"
    >
      {/* Brand lockup. The container is pointer-events-none so drags fall
          through to the bar; the credit link opts back in below. */}
      <div className="pointer-events-none flex items-center gap-2.5">
        <BrandMark size={24} aria-hidden />
        <div className="flex flex-col leading-tight">
          <span className="font-sans text-sm font-bold text-foreground">
            Open<span className="text-[var(--kira-cyan)]">Cohost</span>
          </span>
          {/* Tagline + credit — hidden below xl so brand + chips + gear + caption
              buttons never crowd at the 1280 min window width. */}
          <span className="hidden items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground xl:flex">
            <span>focus over panic</span>
            <span aria-hidden="true" className="text-border">/</span>
            <a
              href="https://github.com/franguh"
              target="_blank"
              rel="noreferrer"
              aria-label="Developed by Franguh"
              className="pointer-events-auto normal-case tracking-normal transition-colors duration-fast ease-io hover:text-[var(--kira-cyan)] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Developed by Franguh
            </a>
          </span>
        </div>
      </div>

      {/* Drag space — the big grab zone between brand and controls. */}
      <div data-tauri-drag-region className="h-full flex-1" />

      {/* App controls (StatusRail + SettingsPopover) portal in here past the
          gate. NOT a drag region: its interactive children must keep clicks. */}
      <div id={TITLEBAR_APP_CONTROLS_SLOT_ID} className="flex min-w-0 items-center gap-3" />

      <div className="flex h-full items-center">
        <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border-soft" />
        <WindowButton
          label="Minimizar"
          icon={<Minus size={15} />}
          onClick={() => void runWindowAction("minimize")}
        />
        <WindowButton
          label="Maximizar"
          icon={<Square size={13} />}
          onClick={() => void runWindowAction("toggleMaximize")}
        />
        <WindowButton
          label="Cerrar"
          icon={<X size={16} />}
          variant="danger"
          onClick={() => void runWindowAction("close")}
        />
      </div>
    </header>
  );
}
