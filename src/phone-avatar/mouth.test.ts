import { describe, expect, it } from 'vitest';
import { Mouth, MOUTH_MAX } from './mouth.js';

function seeded(seed = 7) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
function sample(m: Mouth, from: number, to: number, step = 0.033) {
  const out: number[] = [];
  for (let t = from; t <= to; t += step) out.push(m.value(t));
  return out;
}

describe('Mouth', () => {
  it('stays closed while idle', () => {
    const m = new Mouth(seeded());
    expect(Math.max(...sample(m, 0, 2))).toBe(0);
  });

  it('oscillates within range while speaking', () => {
    const m = new Mouth(seeded());
    m.start(0);
    const v = sample(m, 0, 2);
    expect(Math.max(...v)).toBeGreaterThan(0.3);
    expect(Math.max(...v)).toBeLessThanOrEqual(MOUTH_MAX);
    expect(Math.min(...v.slice(10))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v.slice(10)) - Math.min(...v.slice(10))).toBeGreaterThan(0.1);
  });

  it('is deterministic for the same random source', () => {
    const a = new Mouth(seeded(3));
    const b = new Mouth(seeded(3));
    a.start(0); b.start(0);
    expect(sample(a, 0, 1)).toEqual(sample(b, 0, 1));
  });

  it('decays smoothly to zero after end', () => {
    const m = new Mouth(seeded());
    m.start(0);
    sample(m, 0, 1);
    m.end(1);
    const v = sample(m, 1.033, 2.5);
    expect(v[v.length - 1]).toBeLessThan(0.01);
    expect(v[0]).toBeGreaterThan(0);
  });

  it('opens wider on a word boundary', () => {
    const plain = new Mouth(() => 0.5);
    const pulsed = new Mouth(() => 0.5);
    plain.start(0); pulsed.start(0);
    sample(plain, 0, 1); sample(pulsed, 0, 1);
    pulsed.pulse(1);
    expect(pulsed.value(1.04)).toBeGreaterThan(plain.value(1.04));
  });

  it('clamps extreme random sources and bad clocks', () => {
    const m = new Mouth(() => 1);
    m.start(0); m.pulse(0.1);
    const v = sample(m, 0, 1);
    expect(Math.max(...v)).toBeLessThanOrEqual(MOUTH_MAX);
    expect(m.value(Number.NaN)).toBeGreaterThanOrEqual(0);
    expect(m.value(-5)).toBeGreaterThanOrEqual(0);
  });

  it('reports speaking state', () => {
    const m = new Mouth(seeded());
    expect(m.speaking).toBe(false);
    m.start(0);
    expect(m.speaking).toBe(true);
    m.end(1);
    expect(m.speaking).toBe(false);
  });
});
