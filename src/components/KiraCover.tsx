import type { SyntheticEvent } from "react";
import { useStatusQuery } from "../api/status.js";
import { useAvatarLiveState } from "../store/avatarLiveStore.js";
import { AVATAR_IMAGE, AVATAR_LABEL, FALLBACK_AVATAR, deriveAvatarState } from "./kiraState.js";

function handleAvatarError(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.src = FALLBACK_AVATAR;
}

// Trust the live speaking edge only while fresh; past this the 2s status poll
// has certainly caught up, so a missed speaking_end can't pin "speaking".
const LIVE_SPEAKING_FRESH_MS = 3000;

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
  const { data } = useStatusQuery();
  const liveSpeaking = useAvatarLiveState((s) => s.speaking);
  const liveEventTs = useAvatarLiveState((s) => s.lastEventTs);
  // Prefer the live store only when it says speaking AND is fresh; on
  // speaking=false (or a stale edge) fall straight back to the poll-derived
  // state — same behavior as before the live wiring.
  const avatarState =
    liveSpeaking && Date.now() - liveEventTs < LIVE_SPEAKING_FRESH_MS ? "speaking" : deriveAvatarState(data);
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
      <p className="relative z-10 mb-8 rounded-full border border-border-soft bg-card px-4 py-1.5 text-sm text-foreground">
        <span className="mono font-bold text-[var(--kira-cyan)]">Estado: </span>
        {AVATAR_LABEL[avatarState]}
      </p>

      {/* Avatar zone
          - overflow-hidden + rounded-full clips the image to the circle shape
          - The bottom gradient fade is also clipped, creating a smooth
            circular blend rather than a hard rectangular cutoff */}
      <div className="relative z-10 h-[420px] w-[420px] overflow-hidden rounded-full border border-ring">
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
          alt={`Avatar de Kira — estado ${AVATAR_LABEL[avatarState]}`}
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
          Akira · co-host local · {data?.current_model ?? "cargando…"}
        </p>
      </div>
    </div>
  );
}
