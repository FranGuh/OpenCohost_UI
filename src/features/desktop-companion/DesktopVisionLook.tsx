import { Eye } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { useVisionLookControl } from "../experiencia/VisionLookControl.js";

/** Compact "look" button for the controls strip; same state as the chat control. */
export function DesktopVisionLookButton() {
  const { look, disabled, label, title } = useVisionLookControl();
  return (
    <button
      type="button"
      disabled={disabled}
      title={title ?? label}
      onClick={() => look.mutate()}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border border-border-soft bg-surface-2 px-2 text-[11px] font-semibold text-foreground transition-colors duration-fast",
        "hover:bg-surface-2/60 disabled:opacity-50",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      )}
    >
      <Eye size={12} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}
