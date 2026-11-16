/** Procedural lip-sync for the phone: no audio stream exists, so the mouth is synthesised. */

export const MOUTH_MAX = 0.75;
/** Peak of the syllable wave alone; word-boundary pulses add headroom up to MOUTH_MAX. */
const WAVE_PEAK = 0.55;
const PULSE_BOOST = 0.2;
const PULSE_SEC = 0.15;
const NOISE_STEP_SEC = 0.12;
const ATTACK = 28;
const RELEASE = 14;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Mouth {
  private on = false;
  private startedAt = 0;
  private pulsedAt = Number.NEGATIVE_INFINITY;
  private freq = 7;
  private noise = 0.5;
  private noiseSlot = -1;
  private current = 0;
  private last: number | null = null;

  constructor(private readonly random: () => number = Math.random) {}

  get speaking(): boolean { return this.on; }

  start(now: number): void {
    this.on = true;
    this.startedAt = now;
    this.freq = 6 + this.rand() * 3;
    this.noiseSlot = -1;
  }

  end(_now: number): void { this.on = false; }

  /** A speech word boundary: briefly open wider. */
  pulse(now: number): void { this.pulsedAt = now; }

  /** Mouth openness in [0, MOUTH_MAX] at `now` (seconds). Call with non-decreasing times. */
  value(now: number): number {
    if (!Number.isFinite(now)) return this.current;
    const dt = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    let target = 0;
    if (this.on) {
      const t = Math.max(0, now - this.startedAt);
      const slot = Math.floor(t / NOISE_STEP_SEC);
      if (slot !== this.noiseSlot) { this.noiseSlot = slot; this.noise = this.rand(); }
      const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.freq * t);
      target = WAVE_PEAK * wave * (0.55 + 0.45 * this.noise);
      const since = now - this.pulsedAt;
      if (since >= 0 && since < PULSE_SEC) target += PULSE_BOOST * (1 - since / PULSE_SEC);
    }
    const lambda = target > this.current ? ATTACK : RELEASE;
    this.current += (target - this.current) * (1 - Math.exp(-lambda * dt));
    if (!this.on && this.current < 0.002) this.current = 0;
    this.current = clamp(this.current, 0, MOUTH_MAX);
    return this.current;
  }

  private rand(): number { return clamp(this.random(), 0, 1); }
}
