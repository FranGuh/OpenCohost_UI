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

/**
 * Badge copy for the LOCAL doze (the client inactivity timer, CTK's
 * on_inactivity_timeout). It reuses the sleeping ART but must never read as the
 * backend's `sleeping`, which means "the engine has not warmed up yet"
 * (AVATAR_LABEL.sleeping = "en espera"). Two different facts, one image.
 */
export const LOCAL_SLEEP_LABEL = "dormida";

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

/** Client-side signals the poll cannot carry. All default to false. */
export interface AvatarOverrides {
  /** A PTT hold is open (fresh `avatarLiveStore.listening`). */
  livePtt?: boolean;
  /** Fresh speaking edge from the events poll (`avatarLiveStore.speaking`). */
  liveSpeaking?: boolean;
  /** The local inactivity timer fired — Kira dozed off. */
  asleep?: boolean;
  /** Current phase of the 700ms speaking alternation. */
  alt?: boolean;
}

function labelled(state: AvatarState) {
  return { state, label: AVATAR_LABEL[state] };
}

/**
 * The avatar's single source of truth: the polled backend state plus the three
 * client-local facts it structurally cannot know (an open PTT hold, the
 * alternation phase, and the inactivity doze).
 *
 * Precedence, highest first:
 *  1. listening — a live mic is the most urgent thing on screen, and it is
 *     mutually exclusive with speaking (the operator holds OR Kira talks).
 *  2. speaking (alternating) — from the live edge or the poll.
 *  3. local doze — only from a fully idle state, exactly like CTK's
 *     on_inactivity_timeout, which no-ops unless the avatar is IDLE.
 *  4. whatever the poll derived.
 */
export function resolveAvatar(
  data: Parameters<typeof deriveAvatarState>[0],
  { livePtt = false, liveSpeaking = false, asleep = false, alt = false }: AvatarOverrides = {}
): { state: AvatarState; label: string } {
  if (livePtt) return labelled("listening");
  const base = liveSpeaking ? "speaking" : deriveAvatarState(data);
  if (base === "speaking" || base === "speaking_alt") return labelled(alt ? "speaking_alt" : "speaking");
  if (asleep && base === "idle") return { state: "sleeping", label: LOCAL_SLEEP_LABEL };
  return labelled(base);
}
