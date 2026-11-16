import { VRMA_PATHS } from './vrmAnimator.js';

/** States that own the body and must not be overridden by the look pose. */
const BUSY_STATES = new Set(['speaking', 'speaking_alt', 'listening', 'sleeping']);

export interface ActionAnimationInput {
  /** Vision `looking` flag (a look is in flight). */
  looking: boolean;
  /** Avatar state fed to the animator tick. */
  state?: string;
  /** QA animation request (explicit, wins over everything). */
  qaUrl?: string | null;
}

/**
 * Which one-shot clip should be forced right now, or null for normal idle.
 * Precedence: QA request > looking (calm states only) > normal idle. Speaking
 * takes over the moment the reply starts, so the phone never fights the voice.
 */
export function resolveActionAnimation({ looking, state, qaUrl }: ActionAnimationInput): string | null {
  if (qaUrl) return qaUrl;
  if (looking && !(state && BUSY_STATES.has(state))) return VRMA_PATHS.SMARTPHONE;
  return null;
}
