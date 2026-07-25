import type { PttErrorCode, PttUiState } from "./ptt.js";

/**
 * PTT display copy — extracted verbatim from PTTCard.tsx so both PTTCard and
 * the ConversationPanel composer mic render the SAME strings without a second
 * copy of the maps drifting out of sync. Pure relocation: the literals are
 * unchanged, which is why the PTTCard test suites still pass untouched.
 */
export const ERROR_COPY: Record<PttErrorCode, string> = {
  // liveaudio_url_config: this used to just say "verificá que esté
  // corriendo", which reads as "the process is down" — misleading when the
  // real cause is a wrong port. Now that the URL is visible/editable right
  // below (PTTCard's LiveAudio section), point at both possibilities.
  stt_unreachable:
    "STT (WhisperLive) no disponible — puede estar apagado, o la URL configurada más abajo puede apuntar al puerto equivocado.",
  stt_lost: "Se perdió la conexión con el STT — la sesión se cerró sola.",
  session_not_active: "El servidor cortó la sesión.",
  start_failed: "No se pudo iniciar PTT."
};

export const STATE_COPY: Record<PttUiState, string> = {
  idle: "Mantené para hablar",
  connecting: "Conectando…",
  listening: "Escuchando…",
  flushing: "Procesando…"
};
