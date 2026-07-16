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

/**
 * Custom window chrome for the frameless (decorations:false) Tauri window. The
 * bar itself is the drag region; the brand lockup is pointer-events-none so a
 * mousedown on the logo falls through to the bar and drags — and a double-click
 * on the drag region toggles maximize natively (Tauri handles it, no JS handler
 * here). The three caption buttons keep pointer events and drive the window over
 * IPC. Colors resolve from theme tokens, so the bar re-skins with the app.
 */
export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center justify-between border-b border-border-soft bg-card"
    >
      <div className="pointer-events-none flex items-center gap-2 pl-3">
        <BrandMark size={16} aria-hidden />
        <span className="text-xs text-muted-foreground">OpenCohost</span>
      </div>
      <div className="flex h-full items-center">
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
    </div>
  );
}
