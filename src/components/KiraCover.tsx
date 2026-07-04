import type { SyntheticEvent } from "react";
import { useStatusQuery } from "../api/status.js";
import { Badge } from "./ui/Badge.js";
import { AVATAR_IMAGE, AVATAR_LABEL, AVATAR_TONE, FALLBACK_AVATAR, deriveAvatarState } from "./kiraState.js";

const EQ_COLORS = ["var(--focus)", "var(--pulse)", "var(--focus)", "var(--pulse)"];
const EQ_DELAYS = ["0s", ".2s", ".4s", ".1s"];

function handleAvatarError(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.src = FALLBACK_AVATAR;
}

/**
 * SIGNATURE #1 — the RING/APERTURE: Kira's avatar sits inside a focus-ring
 * (brand signature, see BrandMark), framed by a soft --focus glow. Layered
 * with the state Badge + a 2-tone focus/pulse equalizer that reads as "now
 * playing", not a status widget.
 */
export function KiraCover() {
  const { data } = useStatusQuery();
  const avatarState = deriveAvatarState(data);
  const avatarSrc = AVATAR_IMAGE[avatarState];

  return (
    <div
      className="relative flex h-[340px] w-[340px] items-center justify-center overflow-hidden rounded-[22px] border border-border-soft shadow-panel"
      style={{ backgroundImage: "radial-gradient(120% 80% at 50% 12%, var(--accent-soft), transparent 70%)" }}
    >
      <Badge tone={AVATAR_TONE[avatarState]} mono className="absolute left-3 top-3">
        {AVATAR_LABEL[avatarState]}
      </Badge>

      {/* RING/APERTURE — the brand signature frame. Outer ring stays static;
          the inner ring carries the --focus glow, guarded behind
          prefers-reduced-motion for the breathing pulse. */}
      <div className="relative flex h-[240px] w-[240px] items-center justify-center rounded-full border border-ring">
        <div
          aria-hidden="true"
          className="absolute inset-3 rounded-full border border-primary animate-pulse motion-reduce:animate-none"
          style={{ boxShadow: "0 0 44px var(--accent-soft)" }}
        />
        <img
          src={avatarSrc}
          onError={handleAvatarError}
          alt={`Avatar de Kira — estado ${AVATAR_LABEL[avatarState]}`}
          className="relative h-[180px] w-auto object-contain"
        />
      </div>

      <div aria-hidden="true" className="absolute bottom-3 right-3 flex h-[26px] items-end gap-[3px]">
        {EQ_COLORS.map((color, index) => (
          <i
            key={index}
            className="w-[4px] animate-eq rounded-full motion-reduce:animate-none"
            style={{ backgroundColor: color, animationDelay: EQ_DELAYS[index], height: "8px" }}
          />
        ))}
      </div>
    </div>
  );
}
