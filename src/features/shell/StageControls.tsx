import { useEffect, useId, useRef, useState } from "react";
import { Camera, ChevronDown, Play, Square } from "lucide-react";
import { DesktopModeButton } from "../desktop-companion/DesktopModeButton.js";
import { recordSharedActivity, setSharedAsleep } from "../experiencia/inactivityStore.js";
import type { FramingMode } from "../avatar-vrm/domain/vrmLoader.js";
import { useStageControlsStore } from "../../store/stageControlsStore.js";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";

const FRAMING_OPTIONS: ReadonlyArray<{
  mode: FramingMode;
  label: "shell.stageControls.framing.full" | "shell.stageControls.framing.half" | "shell.stageControls.framing.head";
  title:
    | "shell.stageControls.framing.full.title"
    | "shell.stageControls.framing.half.title"
    | "shell.stageControls.framing.head.title";
}> = [
  { mode: "full", label: "shell.stageControls.framing.full", title: "shell.stageControls.framing.full.title" },
  { mode: "half", label: "shell.stageControls.framing.half", title: "shell.stageControls.framing.half.title" },
  { mode: "head", label: "shell.stageControls.framing.head", title: "shell.stageControls.framing.head.title" }
];

/**
 * Avatar-stage controls rendered inside the title bar (AppLayout portals them
 * into the bar's stage slot while the stage view is active): framing selector and
 * animation test consolidated into a clean camera popover chip, plus desktop mode.
 * They drive the stage through `useStageControlsStore`.
 *
 * No element here carries `data-tauri-drag-region` and each interactive button
 * opts out with `WebkitAppRegion: no-drag`, preserving drag on the bar around it.
 */
export function StageControls() {
  const t = useT();
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const framingMode = useStageControlsStore((s) => s.framingMode);
  const qaRunning = useStageControlsStore((s) => s.qaRunning);
  const stage3dMounted = useStageControlsStore((s) => s.stage3dMounted);
  const setFramingMode = useStageControlsStore((s) => s.setFramingMode);
  const startQa = useStageControlsStore((s) => s.startQa);
  const stopQa = useStageControlsStore((s) => s.stopQa);

  function toggleQa() {
    if (qaRunning) {
      stopQa();
      return;
    }
    recordSharedActivity();
    setSharedAsleep(false);
    startQa();
  }

  // Close popover on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const activeOption = FRAMING_OPTIONS.find((opt) => opt.mode === framingMode) ?? FRAMING_OPTIONS[1];

  return (
    <>
      {stage3dMounted && (
        <div ref={containerRef} className={cn("relative shrink-0 text-left", isOpen && "z-50")}>
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-controls={popoverId}
            aria-haspopup="dialog"
            aria-label={t("shell.stageControls.framing.aria")}
            title={t("shell.stageControls.framing.aria")}
            style={{ WebkitAppRegion: "no-drag" }}
            className={cn(
              "mono relative z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors duration-fast ease-io hover:bg-surface-3 hover:text-foreground",
              isOpen && "border-primary/40 bg-primary/10 text-primary",
              qaRunning && "border-warn-bd text-warn"
            )}
          >
            <Camera
              size={13}
              className={cn("shrink-0 text-dim", isOpen && "text-primary", qaRunning && "animate-pulse text-warn")}
              aria-hidden="true"
            />
            <span className="mono">{t(activeOption.label)}</span>
            {qaRunning && <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse" aria-hidden="true" />}
            <ChevronDown
              size={11}
              className={cn("shrink-0 text-dim transition-transform duration-fast", isOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>

          {isOpen && (
            <div
              id={popoverId}
              role="dialog"
              aria-label={t("shell.stageControls.framing.aria")}
              style={{
                WebkitAppRegion: "no-drag",
                backdropFilter: "var(--surface-blur)",
                WebkitBackdropFilter: "var(--surface-blur)"
              }}
              className="absolute left-0 top-full z-50 mt-1.5 w-60 animate-rise-in rounded-md border border-border-soft bg-card p-3 text-left shadow-panel focus:outline-none"
            >
              {/* Header */}
              <div className="flex items-center gap-1.5 pb-1">
                <Camera size={13} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[13px] font-semibold text-foreground">
                  {t("shell.stageControls.framing.aria")}
                </span>
              </div>

              {/* Framing Options Group */}
              <div
                role="group"
                aria-label={t("shell.stageControls.framing.aria")}
                className="my-2 flex items-center gap-1 rounded-lg bg-surface-2/60 p-1"
              >
                {FRAMING_OPTIONS.map(({ mode, label, title }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFramingMode(mode)}
                    aria-pressed={framingMode === mode}
                    title={t(title)}
                    style={{ WebkitAppRegion: "no-drag" }}
                    className={cn(
                      "relative z-20 flex-1 rounded-md px-2 py-1 text-center text-xs font-semibold transition-colors duration-fast ease-io",
                      framingMode === mode
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                    )}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>

              {/* Action Divider */}
              <div className="mb-1.5 mt-2.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-dim">
                <span>{t("shell.stageControls.qa.section")}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-border-soft" />
              </div>

              {/* Animation QA Action */}
              <button
                type="button"
                onClick={toggleQa}
                title={t("shell.stageControls.qa.start.title")}
                aria-label={qaRunning ? t("shell.stageControls.qa.stop") : t("shell.stageControls.qa.start")}
                style={{ WebkitAppRegion: "no-drag" }}
                className={cn(
                  "relative z-20 flex w-full items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-fast ease-io",
                  qaRunning
                    ? "animate-pulse border border-warn-bd bg-warn/10 text-warn"
                    : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                )}
              >
                {qaRunning ? (
                  <Square size={13} className="fill-current" aria-hidden="true" />
                ) : (
                  <Play size={13} className="fill-current" aria-hidden="true" />
                )}
                <span>
                  {qaRunning ? t("shell.stageControls.qa.stop") : t("shell.stageControls.qa.start")}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
      <DesktopModeButton compact />
    </>
  );
}
