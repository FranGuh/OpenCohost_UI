/** Wires the DOM event contract to model loading, the stage and the mouth. No WebGL here. */
import { attachAvatarEvents } from './contract.js';
import type { ProgressFn } from './model.js';
import type { Mouth } from './mouth.js';

export interface Stage { dispose(): void }
export interface StageInputs {
  mouth: Mouth;
  now: () => number;
  /** Current avatar state name for the animator. */
  getState: () => string;
  /** Called when a model resource (texture) failed to load; the avatar renders without it. */
  onDegraded?: () => void;
}

export interface ControllerOptions {
  target: EventTarget;
  canvas: HTMLCanvasElement;
  mouth: Mouth;
  now: () => number;
  fetchModel: (token: string, onProgress: ProgressFn) => Promise<ArrayBuffer>;
  startStage: (canvas: HTMLCanvasElement, model: ArrayBuffer, inputs: StageInputs) => Promise<Stage>;
}

type Status = 'idle' | 'loading' | 'ready' | 'degraded' | 'unavailable';

export function createController(o: ControllerOptions): { destroy(): void } {
  const { canvas, mouth, now } = o;
  let stage: Stage | null = null;
  let activeToken: string | null = null;
  let generation = 0;
  let state = 'idle';

  const loadingEl = () => document.getElementById('kira-avatar-loading');
  const setStatus = (s: Status) => {
    canvas.dataset.avatarStatus = s;
    canvas.hidden = s === 'unavailable';
    const el = loadingEl();
    if (el && s !== 'loading') el.hidden = true;
  };
  const showProgress = (f: number | null) => {
    const el = loadingEl();
    if (!el) return;
    el.hidden = false;
    el.textContent = f === null ? '...' : `${Math.round(f * 100)}%`;
  };
  const teardown = () => {
    generation++;
    if (stage) { try { stage.dispose(); } catch { /* already gone */ } stage = null; }
    activeToken = null;
  };

  const onAuth = (token: string | null) => {
    if (token === null) { teardown(); setStatus('idle'); return; }
    if (token === activeToken) return;
    teardown();
    activeToken = token;
    const mine = generation;
    setStatus('loading');
    showProgress(0);
    void (async () => {
      try {
        const model = await o.fetchModel(token, f => { if (mine === generation) showProgress(f); });
        if (mine !== generation) return;
        let degraded = false;
        const started = await o.startStage(canvas, model, {
          mouth, now, getState: () => state,
          onDegraded: () => { degraded = true; },
        });
        if (mine !== generation) { started.dispose(); return; }
        stage = started;
        setStatus(degraded ? 'degraded' : 'ready');
      } catch {
        if (mine !== generation) return;
        activeToken = null;
        setStatus('unavailable');
      }
    })();
  };

  setStatus('idle');
  const detach = attachAvatarEvents(o.target, {
    onAuth,
    onSpeech: phase => {
      if (phase === 'start') mouth.start(now());
      else if (phase === 'boundary') mouth.pulse(now());
      else mouth.end(now());
    },
    onState: s => { state = s; },
  });
  return { destroy: () => { detach(); teardown(); } };
}
