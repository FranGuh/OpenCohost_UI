import { describe, expect, it } from 'vitest';
import { callFraming } from './framing.js';

const FOV = 30;

describe('callFraming', () => {
  it('puts the head in the upper third of a portrait view', () => {
    const f = callFraming({ headY: 1.4, aspect: 0.46, fovDeg: FOV });
    const visible = 2 * f.distance * Math.tan((FOV * Math.PI) / 360);
    const top = f.targetY + visible / 2;
    const headFromTop = (top - 1.4) / visible;
    expect(headFromTop).toBeGreaterThan(0.15);
    expect(headFromTop).toBeLessThan(0.4);
  });

  it('keeps shoulders in frame on a narrow phone', () => {
    const f = callFraming({ headY: 1.4, aspect: 0.4, fovDeg: FOV });
    const visible = 2 * f.distance * Math.tan((FOV * Math.PI) / 360);
    expect(visible * 0.4).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it('does not zoom out past a sane cap on extreme aspects', () => {
    const f = callFraming({ headY: 1.4, aspect: 0.05, fovDeg: FOV });
    const visible = 2 * f.distance * Math.tan((FOV * Math.PI) / 360);
    expect(visible).toBeLessThanOrEqual(1.6 + 1e-9);
  });

  it('survives a zero or NaN aspect', () => {
    expect(Number.isFinite(callFraming({ headY: 1.4, aspect: 0, fovDeg: FOV }).distance)).toBe(true);
    expect(Number.isFinite(callFraming({ headY: 1.4, aspect: NaN, fovDeg: FOV }).distance)).toBe(true);
  });
});
