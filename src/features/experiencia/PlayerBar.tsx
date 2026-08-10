import { useState } from "react";
import { useStatusQuery } from "../../api/status.js";
import { useLastReply } from "../../api/chat.js";
import { Badge } from "../../ui/Badge.js";
import { Switch } from "../../ui/Switch.js";
import { useT, type TKey } from "../../i18n/t.js";
import { AVATAR_LABEL, deriveAvatarState } from "./kiraState.js";
import { cn } from "../../lib/cn.js";

// Neutral idle label (spec S3): shown when no reply has landed yet — no
// canned transcript, R8 only ever renders server-provided Kira text.
const NOW_PLAYING_IDLE_LABEL_KEY: TKey = "experiencia.playerBar.nowPlaying.idle";

const TRANSPORT_BUTTONS: ReadonlyArray<{ id: string; icon: string; labelKey: TKey }> = [
  { id: "ptt", icon: "🎙", labelKey: "experiencia.playerBar.transport.ptt.aria" },
  { id: "prev", icon: "⏮", labelKey: "experiencia.playerBar.transport.prev.aria" },
  { id: "next", icon: "⏭", labelKey: "experiencia.playerBar.transport.next.aria" },
  { id: "stop", icon: "◼", labelKey: "experiencia.playerBar.transport.stop.aria" }
];

/** SIGNATURE #2 — <footer> now-playing Kira transport bar. No real audio
 * playback in P1: seek/transport are visual-only, transport clicks reuse
 * the app-wide P2 not-wired-yet note pattern. */
export function PlayerBar() {
  const t = useT();
  const { data } = useStatusQuery();
  const lastReply = useLastReply();
  const [liveVoice, setLiveVoice] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const avatarState = deriveAvatarState(data);
  const isSpeaking = Boolean(data?.is_speaking);
  const nowPlayingLabel = lastReply.data?.text ?? t(NOW_PLAYING_IDLE_LABEL_KEY);

  return (
    <footer
      className="grid h-full grid-cols-[300px_1fr_300px] items-center gap-4 border-t border-border-soft px-4"
      style={{ backgroundColor: "var(--bg-deep)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-md text-lg"
          style={{ backgroundColor: "var(--accent-soft)" }}
        >
          ◈
        </span>
        <div className="flex min-w-0 flex-col gap-[2px]">
          <span className="truncate text-sm font-semibold text-foreground">Kira · {t(AVATAR_LABEL[avatarState])}</span>
          <span className="mono truncate text-xs text-dim">{nowPlayingLabel}</span>
          <Badge tone="ok" className="w-fit">
            TTS Piper
          </Badge>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          {TRANSPORT_BUTTONS.slice(0, 2).map((button) => (
            <button
              key={button.id}
              type="button"
              aria-label={t(button.labelKey)}
              onClick={() => setLastAction(t(button.labelKey))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {button.icon}
            </button>
          ))}

          <button
            type="button"
            aria-label={t("experiencia.playerBar.transport.play.aria")}
            onClick={() => setLastAction(t("experiencia.playerBar.transport.play.action"))}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full text-lg transition-colors duration-fast ease-io focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              isSpeaking
                ? "bg-[image:var(--accent-grad)] text-primary-foreground"
                : "bg-surface-2 text-foreground"
            )}
          >
            ▶
          </button>

          {TRANSPORT_BUTTONS.slice(2).map((button) => (
            <button
              key={button.id}
              type="button"
              aria-label={t(button.labelKey)}
              onClick={() => setLastAction(t(button.labelKey))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {button.icon}
            </button>
          ))}
        </div>

        <div className="flex w-full max-w-[420px] items-center gap-2">
          <span className="mono text-[11px] text-dim">0:00</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full w-[35%]" style={{ backgroundImage: "var(--accent-grad)" }} />
          </div>
          <span className="mono text-[11px] text-dim">--:--</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Switch checked={liveVoice} onChange={setLiveVoice} aria-label="LiveVoice" />
        <span aria-hidden="true" className="text-sm text-dim">
          🔊
        </span>
        <div className="h-1 w-[70px] overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[60%] bg-muted-foreground" />
        </div>
      </div>

      {lastAction && (
        <p role="status" className="sr-only">
          {t("experiencia.playerBar.action.notice", { action: lastAction })}
        </p>
      )}
    </footer>
  );
}
