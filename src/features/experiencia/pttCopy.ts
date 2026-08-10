import type { PttErrorCode, PttUiState } from "../../api/ptt.js";
import { t, type TKey } from "../../i18n/t.js";

/**
 * PTT display copy — read by both PTTCard (controles) and the
 * ConversationPanel composer mic (experiencia) so they render the SAME
 * strings. Keys live in the experiencia bundle (ownership, not folder — see
 * docs/UI_DOMAIN_I18N_MIGRATION.md §5/§6 E11). Functions, not frozen
 * Records, so a locale flip hot-swaps both readers instead of freezing at
 * module-eval time.
 */
const ERROR_KEYS: Record<PttErrorCode, TKey> = {
  stt_unreachable: "experiencia.ptt.error.sttUnreachable",
  stt_lost: "experiencia.ptt.error.sttLost",
  session_not_active: "experiencia.ptt.error.sessionNotActive",
  start_failed: "experiencia.ptt.error.startFailed"
};

export function errorCopy(code: PttErrorCode): string {
  return t(ERROR_KEYS[code]);
}

const STATE_KEYS: Record<PttUiState, TKey> = {
  idle: "experiencia.ptt.state.idle",
  connecting: "experiencia.ptt.state.connecting",
  listening: "experiencia.ptt.state.listening",
  flushing: "experiencia.ptt.state.flushing"
};

export function stateCopy(state: PttUiState): string {
  return t(STATE_KEYS[state]);
}
