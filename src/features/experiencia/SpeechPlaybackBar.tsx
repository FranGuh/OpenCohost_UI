import { Pause, Play, Square } from "lucide-react";
import type { SpeechState } from "../../api/speech.js";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";

/** The bar is shown only while read-aloud has something to control. */
export function shouldShowPlaybackBar(state: SpeechState | undefined): boolean {
  return Boolean(state && (state.readaloud_active || state.readaloud_pending > 0 || state.paused));
}

interface SpeechPlaybackBarProps {
  state: SpeechState | undefined;
  /** Disables the controls while a speech request is in flight. */
  busy?: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

const BUTTON_CLASS = cn(
  "inline-flex h-7 items-center gap-1 rounded-md border border-border-soft px-2 text-xs font-semibold text-foreground transition-colors",
  "hover:bg-surface-2 disabled:opacity-50",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
);

/** Presentational compact playback bar: Stop plus a Pause/Resume toggle. */
export function SpeechPlaybackBar({ state, busy = false, onStop, onPause, onResume }: SpeechPlaybackBarProps) {
  const t = useT();
  if (!state || !shouldShowPlaybackBar(state)) return null;
  return (
    <div
      role="group"
      aria-label={t("experiencia.readaloud.bar.label")}
      className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1"
    >
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {state.paused ? t("experiencia.readaloud.bar.paused") : t("experiencia.readaloud.bar.reading")}
        {state.readaloud_pending > 0 && ` · ${t("experiencia.readaloud.bar.pending", { count: state.readaloud_pending })}`}
      </span>
      {state.paused ? (
        <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={onResume} aria-label={t("experiencia.readaloud.bar.resume")}>
          <Play size={12} aria-hidden="true" />
        </button>
      ) : (
        <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={onPause} aria-label={t("experiencia.readaloud.bar.pause")}>
          <Pause size={12} aria-hidden="true" />
        </button>
      )}
      <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={onStop} aria-label={t("experiencia.readaloud.bar.stop")}>
        <Square size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
