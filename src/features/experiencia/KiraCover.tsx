import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { useStatusQuery } from "../../api/status.js";
import { useAvatarLiveState } from "../../store/avatarLiveStore.js";
import { t, useT } from "../../i18n/t.js";
import { AVATAR_IMAGE, FALLBACK_AVATAR, deriveAvatarState, resolveAvatar } from "./kiraState.js";

function handleAvatarError(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.src = FALLBACK_AVATAR;
}

/**
 * F4 fix (runtime_findings_batch_20260731 1.3): the identity row used to
 * hardcode the literal "co-host local" — a lie the moment a cloud provider
 * (or an active fallback) was in play. Derived from the backend's LIVE
 * provider/transport truth (StatusResponse.transport/.fallback_active),
 * never guessed client-side. Undefined fields (older backend / not loaded
 * yet) degrade to the historical "co-host local" text.
 */
function coHostLabel(data: { transport?: string; fallback_active?: boolean } | undefined): string {
  if (data?.transport === "cloud") return t("experiencia.kiraCover.identity.coHost.cloud");
  if (data?.fallback_active) return t("experiencia.kiraCover.identity.coHost.localFallback");
  return t("experiencia.kiraCover.identity.coHost.local");
}

/**
 * Unit 2.5 (runtime_findings_batch_20260731 F13): session-level mode above
 * AgendaState.OFF, DERIVED backend-side (StatusResponse.session_mode) — never
 * re-derived here. Undefined (older backend / not loaded yet) renders nothing,
 * same degrade-quietly convention as the rest of this identity row.
 */
function sessionModeLabel(mode: string | undefined): string | null {
  if (mode === "agenda") return t("experiencia.kiraCover.identity.sessionMode.agenda");
  if (mode === "post-agenda") return t("experiencia.kiraCover.identity.sessionMode.postAgenda");
  if (mode === "inactiva") return t("experiencia.kiraCover.identity.sessionMode.inactiva");
  return null;
}

// Trust the live speaking edge only while fresh; past this the 2s status poll
// has certainly caught up, so a missed speaking_end can't pin "speaking".
const LIVE_SPEAKING_FRESH_MS = 3000;

// Same idea for an open PTT hold, but here the stamp is a real HEARTBEAT: the
// 1Hz keepalive and the 1Hz server poll both re-stamp it while the mic is live
// (avatarLiveStore.setListening), so three missed beats means the session is
// gone — which is precisely when the server's own keepalive watchdog kills it.
// Unlike `speaking`, there is no status-poll fallback to catch a lost release:
// the backend's avatar_state cannot express "listening" at all.
const LIVE_PTT_FRESH_MS = 3000;

/** CTK parity: `app_shell.py:273` `_inactivity_timeout_ms = 2 * 60 * 1000`. */
export const SLEEP_AFTER_IDLE_MS = 2 * 60 * 1000;

/** CTK parity: `motor_event_handlers.py::tick_speaking_alt` reschedules at 700ms. */
export const SPEAKING_ALT_MS = 700;

/**
 * Kira dozes off after a stretch of nothing happening — a purely CLIENT-LOCAL
 * timer, exactly like CTK's `on_inactivity_timeout`
 * (`opencohost/ui/motor_event_handlers.py:310-324`), which also only fires from
 * an IDLE state and involves the backend not at all.
 *
 * This has NOTHING to do with the backend's `avatar_state: "sleeping"`, which
 * means "the engine has not warmed up yet" and is false for the whole rest of
 * the session. Two different facts that happen to share one drawing.
 *
 * The transition is SCHEDULED (setTimeout), never a freshness comparison
 * evaluated during render — otherwise it would only appear whenever some
 * unrelated poll happened to re-render the component.
 */
function useIdleDoze(busy: boolean, activityTs: number): boolean {
  const [asleep, setAsleep] = useState(false);
  useEffect(() => {
    // Reached only on a genuine activity edge (busy flipped, or a newer live
    // event landed) — so waking here is correct, and re-arming is CTK's
    // `_reset_inactivity_timer`.
    setAsleep(false);
    if (busy) return;
    const timer = setTimeout(() => setAsleep(true), SLEEP_AFTER_IDLE_MS);
    return () => clearTimeout(timer);
  }, [busy, activityTs]);
  return asleep;
}

/** The 700ms SPEAKING <-> SPEAKING_ALT flip-flop CTK runs while Kira talks
 * (`start_speaking_alt_timer`), so her mouth/pose actually moves. */
function useSpeakingAlt(speaking: boolean): boolean {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    if (!speaking) {
      setAlt(false);
      return;
    }
    const timer = setInterval(() => setAlt((current) => !current), SPEAKING_ALT_MS);
    return () => clearInterval(timer);
  }, [speaking]);
  return alt;
}

/**
 * Kira's main presence view — the brand ring/aperture framing her avatar with
 * an ambient glow, status badge, and identity row.
 *
 * The outer ring is overflow-hidden + rounded-full, clipping the image to a
 * perfect circle. A linear gradient overlay at the bottom fades the lower body
 * away instead of a hard crop — the gradient is itself clipped to the circle
 * by the parent overflow-hidden. The inner ring carries the --focus glow with
 * a breathing pulse (guarded behind prefers-reduced-motion).
 */
export function KiraCover() {
  const t = useT();
  const { data } = useStatusQuery();
  const liveSpeaking = useAvatarLiveState((s) => s.speaking);
  const liveEventTs = useAvatarLiveState((s) => s.lastEventTs);
  const livePtt = useAvatarLiveState((s) => s.listening);
  const livePttTs = useAvatarLiveState((s) => s.lastPttTs);

  // Trust either live signal only while fresh; on false (or a stale edge) fall
  // straight back to the poll-derived state.
  const now = Date.now();
  const freshSpeaking = liveSpeaking && now - liveEventTs < LIVE_SPEAKING_FRESH_MS;
  const freshPtt = livePtt && now - livePttTs < LIVE_PTT_FRESH_MS;

  const polled = deriveAvatarState(data);
  const speaking = freshSpeaking || polled === "speaking";
  const alt = useSpeakingAlt(speaking);
  // CTK resets its inactivity timer on listening/processing/idle pipeline states
  // (app_shell.py:1798-1800). "busy" is the same idea: anything happening right
  // now. A cold engine ("sleeping" from the poll) is NOT activity — otherwise
  // the countdown would never even start.
  const busy = freshPtt || speaking || (polled !== "idle" && polled !== "sleeping");
  const asleep = useIdleDoze(busy, Math.max(liveEventTs, livePttTs));

  const { state: avatarState, label: avatarLabel } = resolveAvatar(data, {
    livePtt: freshPtt,
    liveSpeaking: freshSpeaking,
    asleep,
    alt
  });
  const avatarSrc = AVATAR_IMAGE[avatarState];

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden">
      {/* Ambient glow centred on the avatar zone */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 60%, var(--accent-soft), transparent 68%)"
        }}
      />

      {/* Status badge */}
      {/* <p className="relative z-10 mb-8 rounded-full border border-border-soft bg-card px-4 py-1.5 text-sm text-foreground">
        <span className="mono font-bold text-[var(--kira-cyan)]">Estado: </span>
        {avatarLabel}
      </p> */}

      {/* Avatar zone
          - overflow-hidden + rounded-full clips the image to the circle shape
          - The bottom gradient fade is also clipped, creating a smooth
            circular blend rather than a hard rectangular cutoff */}
      <div className="relative z-10 h-[520px] w-[520px] overflow-hidden rounded-full border border-ring">
        {/* Inner breathing ring */}
        <div
          aria-hidden="true"
          className="absolute inset-3 rounded-full border border-primary animate-pulse motion-reduce:animate-none"
          style={{ boxShadow: "0 0 60px var(--accent-soft)" }}
        />
        {/* Avatar image */}
        <img
          src={avatarSrc}
          onError={handleAvatarError}
          alt={t("experiencia.kiraCover.avatar.alt", { state: t(avatarLabel) })}
          className="h-full w-full object-contain"
        />
        {/* Bottom gradient fade — clipped to circle, blends the lower body away */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-44"
          style={{
            background: "linear-gradient(to top, var(--bg-deep, var(--background)), transparent)"
          }}
        />
      </div>

      {/* Identity */}
      <div className="relative z-10 mt-6 flex flex-col items-center gap-1 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Kira</h1>
        <p className="mono text-xs text-muted-foreground">
          Akira · {coHostLabel(data)} · {data?.current_model ?? t("experiencia.kiraCover.identity.model.loading")}
          {sessionModeLabel(data?.session_mode) && ` · ${sessionModeLabel(data?.session_mode)}`}
        </p>
      </div>
    </div>
  );
}
