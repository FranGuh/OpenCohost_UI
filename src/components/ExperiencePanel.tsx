import { useState } from "react";
import type { ChangeEvent, SyntheticEvent } from "react";
import { useStatusQuery } from "../api/status.js";
import type { StatusResponse } from "../api/client.js";
import { healthTone } from "./StatusRail.js";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import type { BadgeTone } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";

type AvatarState = "idle" | "speaking" | "thinking" | "sleeping" | "error";

const AVATAR_IMAGE: Record<AvatarState, string> = {
  idle: "/avatar/idle.png",
  speaking: "/avatar/speaking.png",
  thinking: "/avatar/thinking.png",
  sleeping: "/avatar/sleeping.png",
  error: "/avatar/error.png"
};

const AVATAR_LABEL: Record<AvatarState, string> = {
  idle: "en vivo",
  speaking: "hablando",
  thinking: "pensando",
  sleeping: "en espera",
  error: "error"
};

const AVATAR_TONE: Record<AvatarState, BadgeTone> = {
  idle: "ok",
  speaking: "info",
  thinking: "warn",
  sleeping: "neutral",
  error: "danger"
};

// Committed fallback (public/kira-error.png) — used when an avatar/*.png is
// missing, since public/avatar/ is gitignored (owner-local art, see .gitignore).
const FALLBACK_AVATAR = "/kira-error.png";

const DEFAULT_TRANSCRIPT =
  "Preparando el motor… en un toque estoy lista para el próximo comentario.";

// P2: listening.png / angry.png / speaking_alt.png are copied to
// public/avatar/ for future states (PTT listening, mood swings) but
// /api/status has no signal for them yet — not wired into deriveAvatarState.
function deriveAvatarState(
  data: Pick<StatusResponse, "is_speaking" | "is_processing" | "is_ready" | "health"> | undefined
): AvatarState {
  if (!data) return "sleeping";
  if (data.is_speaking) return "speaking";
  if (data.is_processing) return "thinking";
  if (healthTone(data.health.overall_status) === "danger") return "error";
  if (!data.is_ready) return "sleeping";
  return "idle";
}

/**
 * "Experiencia principal" — left panel: avatar with live state, the
 * "Hablar" primary action, a preset "Respuesta de Kira" transcript, and a
 * composer preview. Mockup treatment: scratchpad/kira-redesign.html's
 * `.avatar`/`.primary`/`.composer`.
 *
 * No speak or chat endpoint exists in P1 (spec non-goals) — Hablar and
 * Enviar surface a role="status" P2 note instead of fabricating a backend
 * call, matching MemoryCard's not-wired-yet pattern.
 */
export function ExperiencePanel() {
  const { data } = useStatusQuery();
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const avatarState = deriveAvatarState(data);
  const avatarSrc = AVATAR_IMAGE[avatarState];

  function handleAvatarError(event: SyntheticEvent<HTMLImageElement>) {
    event.currentTarget.src = FALLBACK_AVATAR;
  }

  function handleMessageChange(event: ChangeEvent<HTMLInputElement>) {
    setMessage(event.target.value);
  }

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Kira</h1>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
          Experiencia principal
        </span>
      </div>

      <div className="relative flex h-[216px] items-center justify-center overflow-hidden rounded-lg border border-border bg-[radial-gradient(120%_80%_at_50%_12%,var(--accent-soft),transparent_60%)]">
        <Badge tone={AVATAR_TONE[avatarState]} className="absolute left-3 top-3">
          {AVATAR_LABEL[avatarState]}
        </Badge>
        <img
          src={avatarSrc}
          onError={handleAvatarError}
          alt={`Avatar de Kira — estado ${AVATAR_LABEL[avatarState]}`}
          className="h-[150px] w-auto object-contain"
        />
        <span className="absolute bottom-[11px] right-3 text-[11px] text-dim">avatar Kira</span>
      </div>

      <Button
        type="button"
        variant="primary"
        className="h-[74px] w-full text-[22px] font-extrabold"
        onClick={() => setLastAction("Hablar")}
      >
        Hablar
      </Button>

      <Card className="p-4">
        <div className="mb-[10px] flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-foreground">Respuesta de Kira</h2>
          <Badge tone="info">preparando</Badge>
        </div>
        <p className="rounded-md border border-border bg-background p-[14px] text-[15px] leading-relaxed text-foreground">
          <span className="font-bold text-primary">[Kira] </span>
          {DEFAULT_TRANSCRIPT}
        </p>
      </Card>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          type="text"
          value={message}
          onChange={handleMessageChange}
          placeholder="Escribí un mensaje para Kira…"
          aria-label="Mensaje para Kira"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <Button
          type="button"
          variant="ghost"
          className="bg-[var(--accent-soft)] text-primary"
          onClick={() => setLastAction("Enviar")}
        >
          Enviar
        </Button>
      </div>

      {lastAction && (
        <p role="status" className="text-xs text-muted-foreground">
          {lastAction}: se habilitará cuando el backend lo soporte.
        </p>
      )}
    </Card>
  );
}
