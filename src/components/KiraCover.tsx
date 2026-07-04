import type { SyntheticEvent } from "react";
import { useStatusQuery } from "../api/status.js";
import { Badge } from "./ui/Badge.js";
import { AVATAR_IMAGE, AVATAR_LABEL, AVATAR_TONE, FALLBACK_AVATAR, deriveAvatarState } from "./kiraState.js";

// const EQ_COLORS = ["var(--focus)", "var(--pulse)", "var(--focus)", "var(--pulse)"];
// const EQ_DELAYS = ["0s", ".2s", ".4s", ".1s"];

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
      className="relative flex h-[100dvh] w-[100%] flex-col items-center justify-center gap-[10px] overflow-hidden"
      // style={{ backgroundImage: "radial-gradient(120% 80% at 50% 12%, var(--accent-soft), transparent 70%)" }}
    >
      {/* Estado — fijado arriba (position: fixed) */}
      
      {/* 
        Ponemos estado pero con diseño malo y abajo afuera del componente hay [Kira] Estado: en espera
        osea se vuelve inservible esto. esta mejor diseñado el de afuera.
      <Badge tone={AVATAR_TONE[avatarState]} mono className="absolute left-3 top-3">
        {AVATAR_LABEL[avatarState]}
      </Badge> */}

      {/* RING/APERTURE — the brand signature frame. Outer ring stays static;
          the inner ring carries the --focus glow, guarded behind
          prefers-reduced-motion for the breathing pulse. */}

      <p className="fixed left-2/5 top-1/4 z-50 -translate-x-1/2 rounded-full border border-border-soft bg-card px-4 py-2 text-sm text-foreground">
        <span className="mono font-bold text-[var(--kira-cyan)]">Estado: </span>
        {AVATAR_LABEL[avatarState]}
      </p>
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

      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Kira</h1>
        <p className="mono text-xs text-muted-foreground">Akira · co-host local · {data?.current_model ?? "cargando…"}</p>
      </div>

      

      {/* 
        Que poronga hace esto? esta medio raro. solo agrega ruido a la UI
      <div aria-hidden="true" className="absolute bottom-3 right-3 flex h-[26px] items-end gap-[3px]">
        {EQ_COLORS.map((color, index) => (
          <i
            key={index}
            className="w-[4px] animate-eq rounded-full motion-reduce:animate-none"
            style={{ backgroundColor: color, animationDelay: EQ_DELAYS[index], height: "8px" }}
          />
        ))}
      </div> */}
    </div>
  );
}
