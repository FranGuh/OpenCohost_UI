import { describe, expect, it } from 'vitest';
import { resolveActionAnimation } from './lookAnimation.js';
import { VRMA_PATHS } from './vrmAnimator.js';

describe('resolveActionAnimation precedence', () => {
  it('plays the smartphone clip while looking in a calm state', () => {
    for (const state of [undefined, 'idle', 'thinking']) {
      expect(resolveActionAnimation({ looking: true, state })).toBe(VRMA_PATHS.SMARTPHONE);
    }
  });
  it('returns to normal (null) when looking ends', () => {
    expect(resolveActionAnimation({ looking: false, state: 'idle' })).toBeNull();
  });
  it('speaking, listening and sleeping take over from looking', () => {
    for (const state of ['speaking', 'speaking_alt', 'listening', 'sleeping']) {
      expect(resolveActionAnimation({ looking: true, state })).toBeNull();
    }
  });
  it('a QA animation request beats looking', () => {
    expect(resolveActionAnimation({ looking: true, state: 'idle', qaUrl: '/qa.vrma' })).toBe('/qa.vrma');
  });
  it('passes the QA url through when not looking', () => {
    expect(resolveActionAnimation({ looking: false, qaUrl: '/qa.vrma' })).toBe('/qa.vrma');
  });
});
