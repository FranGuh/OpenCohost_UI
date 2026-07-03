import type { StatusResponse } from "../api/client.js";
import type { BadgeTone } from "./ui/Badge.js";
import { healthTone } from "./StatusRail.js";

export type AvatarState = "idle" | "speaking" | "thinking" | "sleeping" | "error";

export const AVATAR_IMAGE: Record<AvatarState, string> = {
  idle: "/avatar/idle.png",
  speaking: "/avatar/speaking.png",
  thinking: "/avatar/thinking.png",
  sleeping: "/avatar/sleeping.png",
  error: "/avatar/error.png"
};

export const AVATAR_LABEL: Record<AvatarState, string> = {
  idle: "en vivo",
  speaking: "hablando",
  thinking: "pensando",
  sleeping: "en espera",
  error: "error"
};

export const AVATAR_TONE: Record<AvatarState, BadgeTone> = {
  idle: "ok",
  speaking: "info",
  thinking: "warn",
  sleeping: "neutral",
  error: "danger"
};

// Committed fallback (public/kira-error.png) — used when an avatar/*.png is
// missing, since public/avatar/ is gitignored (owner-local art, see .gitignore).
export const FALLBACK_AVATAR = "/kira-error.png";

export const DEFAULT_TRANSCRIPT =
  "Preparando el motor… en un toque estoy lista para el próximo comentario.";

// P2: listening.png / angry.png / speaking_alt.png are copied to
// public/avatar/ for future states (PTT listening, mood swings) but
// /api/status has no signal for them yet — not wired into deriveAvatarState.
export function deriveAvatarState(
  data: Pick<StatusResponse, "is_speaking" | "is_processing" | "is_ready" | "health"> | undefined
): AvatarState {
  if (!data) return "sleeping";
  if (data.is_speaking) return "speaking";
  if (data.is_processing) return "thinking";
  if (healthTone(data.health.overall_status) === "danger") return "error";
  if (!data.is_ready) return "sleeping";
  return "idle";
}
