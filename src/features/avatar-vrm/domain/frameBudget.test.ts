import { describe, expect, it } from 'vitest';
import { shouldRender, targetFps } from './frameBudget.js';

describe('targetFps', () => {
  it('caps idle and sleeping at 30 fps', () => {
    expect(targetFps('idle')).toBe(30);
    expect(targetFps('sleeping')).toBe(30);
  });
  it('caps speaking, listening and thinking at 60 fps', () => {
    for (const s of ['speaking', 'speaking_alt', 'listening', 'thinking']) expect(targetFps(s)).toBe(60);
  });
  it('keeps 60 fps for lip-sync even when state is idle', () => {
    expect(targetFps('idle', true)).toBe(60);
  });
  it('defaults unknown states to 60', () => {
    expect(targetFps('whatever')).toBe(60);
  });
});

describe('shouldRender', () => {
  it('renders when the budget has elapsed', () => {
    expect(shouldRender(1000 / 30, 0, 30)).toBe(true);
    expect(shouldRender(100, 0, 30)).toBe(true);
  });
  it('skips frames under the budget', () => {
    expect(shouldRender(16, 0, 30)).toBe(false);
  });
  it('tolerates rAF jitter just under the budget', () => {
    expect(shouldRender(1000 / 30 - 1, 0, 30)).toBe(true);
  });
  it('always renders when uncapped', () => {
    expect(shouldRender(1, 0, Number.POSITIVE_INFINITY)).toBe(true);
  });
  it('renders the first frame', () => {
    expect(shouldRender(5, Number.NEGATIVE_INFINITY, 30)).toBe(true);
  });
});
