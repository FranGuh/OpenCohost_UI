import { useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { postSpeechSay, postSpeechStop } from "../../api/speech.js";
import { KiraFace } from "../../ui/KiraFace.js";
import { Button } from "../../ui/Button.js";
import { Badge } from "../../ui/Badge.js";
import { useT } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";

/**
 * Speaks Kira's fixed setup line through the existing read-aloud route
 * (POST /api/speech/say) whenever the line changes and voice is enabled.
 * Fire-and-forget: a missing speech router (503) or a guard block only means
 * the text stays on screen, which it always does. Muting stops what this
 * narrator queued; it never touches speech it did not start.
 */
export function useNarrationVoice(line: string, enabled: boolean): void {
  const spokeRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    spokeRef.current = true;
    postSpeechSay(line, "now").catch(() => undefined);
  }, [line, enabled]);

  useEffect(() => {
    if (enabled || !spokeRef.current) return;
    spokeRef.current = false;
    postSpeechStop().catch(() => undefined);
  }, [enabled]);
}

export interface KiraNarratorProps {
  line: string;
  muted: boolean;
  /** The user said they could not hear Kira: narration stays silent. */
  textMode: boolean;
  onToggleMute(): void;
  /** Panel variant: a slim row above the step instead of a side column. */
  compact?: boolean;
}

/** Kira's speech bubble. Static markup — no animation loop, no avatar coupling. */
export function KiraNarrator({ line, muted, textMode, onToggleMute, compact = false }: KiraNarratorProps) {
  const t = useT();
  const statusKey = textMode ? "setup.kira.status.textMode" : muted ? "setup.kira.status.muted" : "setup.kira.status.speaking";

  return (
    <aside
      aria-label={t("setup.kira.name")}
      className={cn(
        "flex shrink-0 flex-col gap-3 bg-surface-2",
        compact ? "border-b border-border-soft p-4" : "border-b border-border-soft p-5 md:border-b-0 md:border-r md:p-6"
      )}
    >
      <div className="flex items-center gap-3">
        <KiraFace size={compact ? 32 : 44} aria-hidden />
        <div className="flex min-w-0 flex-col">
          <span className="text-base font-bold text-foreground">{t("setup.kira.name")}</span>
          <Badge tone={textMode || muted ? "neutral" : "info"} className="mt-1 self-start px-2 py-0.5 text-[11px]">
            {t(statusKey)}
          </Badge>
        </div>
      </div>

      <p
        aria-live="polite"
        className="relative rounded-xl rounded-tl-sm border border-border-soft bg-card px-4 py-3 text-sm leading-relaxed text-foreground shadow-soft"
      >
        {line}
      </p>

      <Button
        type="button"
        variant="outline"
        aria-pressed={muted}
        onClick={onToggleMute}
        className="h-9 self-start px-3 text-xs"
      >
        {muted ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
        {t("setup.kira.mute")}
      </Button>

      {!compact && <p className="mt-auto text-xs leading-relaxed text-muted-foreground">{t("setup.kira.note")}</p>}
    </aside>
  );
}
