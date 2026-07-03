import type { SyntheticEvent } from "react";
import { useStatusQuery } from "../api/status.js";
import { Badge } from "./ui/Badge.js";
import { AVATAR_IMAGE, AVATAR_LABEL, AVATAR_TONE, FALLBACK_AVATAR, deriveAvatarState } from "./kiraState.js";

const EQ_COLORS = ["var(--kira-cyan)", "var(--kira-violet)", "var(--kira-pink)", "var(--kira-amber)"];
const EQ_DELAYS = ["0s", ".2s", ".4s", ".1s"];

function handleAvatarError(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.src = FALLBACK_AVATAR;
}

/**
 * SIGNATURE #1 — album-art cover for Kira's live avatar state. Layered
 * spectrum-soft panel + state Badge + a 4-bar spectrum equalizer that reads
 * as "now playing", not a status widget.
 */
export function KiraCover() {
  const { data } = useStatusQuery();
  const avatarState = deriveAvatarState(data);
  const avatarSrc = AVATAR_IMAGE[avatarState];

  return (
    <div
      className="relative flex h-[340px] w-[340px] items-center justify-center overflow-hidden rounded-[22px] border border-border-soft shadow-panel"
      style={{
        backgroundImage:
          "radial-gradient(120% 80% at 50% 12%, var(--spectrum-gloss), transparent 60%), var(--spectrum-soft)"
      }}
    >
      <Badge tone={AVATAR_TONE[avatarState]} className="absolute left-3 top-3">
        {AVATAR_LABEL[avatarState]}
      </Badge>
      <img
        src={avatarSrc}
        onError={handleAvatarError}
        alt={`Avatar de Kira — estado ${AVATAR_LABEL[avatarState]}`}
        className="h-[220px] w-auto object-contain"
      />
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
