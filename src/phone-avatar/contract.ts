/** DOM event contract between phone.js (dispatcher) and the avatar bundle (listener). */

export const EVT_AUTH = 'kira:auth';
export const EVT_SPEECH = 'kira:speech';
export const EVT_STATE = 'kira:state';

export type SpeechPhase = 'start' | 'boundary' | 'end';
export type AvatarState = 'idle' | 'thinking' | 'speaking';

export interface AvatarEventHandlers {
  /** token string = paired, null = unpaired / auth lost */
  onAuth(token: string | null): void;
  onSpeech(phase: SpeechPhase): void;
  onState(state: string): void;
}

const PHASES: readonly string[] = ['start', 'boundary', 'end'];

function detailOf(e: Event): Record<string, unknown> | null {
  const d = (e as CustomEvent).detail;
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : null;
}

export function attachAvatarEvents(target: EventTarget, h: AvatarEventHandlers): () => void {
  const auth = (e: Event) => {
    const d = detailOf(e);
    if (!d) return;
    if (d.token === null) h.onAuth(null);
    else if (typeof d.token === 'string' && d.token) h.onAuth(d.token);
  };
  const speech = (e: Event) => {
    const p = detailOf(e)?.phase;
    if (typeof p === 'string' && PHASES.includes(p)) h.onSpeech(p as SpeechPhase);
  };
  const state = (e: Event) => {
    const s = detailOf(e)?.state;
    if (typeof s === 'string' && s) h.onState(s);
  };
  target.addEventListener(EVT_AUTH, auth);
  target.addEventListener(EVT_SPEECH, speech);
  target.addEventListener(EVT_STATE, state);
  return () => {
    target.removeEventListener(EVT_AUTH, auth);
    target.removeEventListener(EVT_SPEECH, speech);
    target.removeEventListener(EVT_STATE, state);
  };
}
