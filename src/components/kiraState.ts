import type { StatusResponse } from "../api/client.js";
import type { BadgeTone } from "./ui/Badge.js";

export type AvatarState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "speaking_alt"
  | "sleeping"
  | "angry"
  | "error";

export const AVATAR_IMAGE: Record<AvatarState, string> = {
  idle: "/avatar/idle.png",
  listening: "/avatar/listening.png",
  thinking: "/avatar/thinking.png",
  speaking: "/avatar/speaking.png",
  speaking_alt: "/avatar/speaking_alt.png",
  sleeping: "/avatar/sleeping.png",
  angry: "/avatar/angry.png",
  error: "/avatar/error.png"
};

export const AVATAR_LABEL: Record<AvatarState, string> = {
  idle: "en vivo",
  listening: "escuchando",
  thinking: "pensando",
  speaking: "hablando",
  speaking_alt: "hablando",
  sleeping: "en espera",
  angry: "molesta",
  error: "error"
};

export const AVATAR_TONE: Record<AvatarState, BadgeTone> = {
  idle: "ok",
  listening: "info",
  thinking: "warn",
  speaking: "info",
  speaking_alt: "info",
  sleeping: "neutral",
  angry: "danger",
  error: "danger"
};

// Committed fallback (public/kira-error.png) — used when an avatar/*.png is
// missing, since public/avatar/ is gitignored (owner-local art, see .gitignore).
export const FALLBACK_AVATAR = "/kira-error.png";

const KNOWN_AVATAR_STATES = new Set<AvatarState>([
  "idle",
  "listening",
  "thinking",
  "speaking",
  "speaking_alt",
  "sleeping",
  "angry",
  "error"
]);

// F4: prefer the backend-supplied avatar_state (real pipeline signal) when the
// server sends a recognized value. Otherwise fall back to the local derivation
// from is_speaking/is_processing/is_ready (F2 behavior). The backend can only
// derive the coarse set today (see models.py::StatusResponse.avatar_state), but
// the richer states (listening/speaking_alt/angry) are honored here for when the
// pipeline exposes them.
export function deriveAvatarState(
  data:
    | Pick<StatusResponse, "is_speaking" | "is_processing" | "is_ready" | "health" | "avatar_state">
    | undefined
): AvatarState {
  if (!data) return "sleeping";
  if (data.avatar_state && KNOWN_AVATAR_STATES.has(data.avatar_state as AvatarState)) {
    return data.avatar_state as AvatarState;
  }
  if (data.is_speaking) return "speaking";
  if (data.is_processing) return "thinking";
  if (!data.is_ready) return "sleeping";
  return "idle";
}
