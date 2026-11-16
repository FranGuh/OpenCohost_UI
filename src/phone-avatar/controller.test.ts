import { describe, expect, it, vi } from 'vitest';
import { createController } from './controller.js';
import { ModelError } from './model.js';
import { Mouth } from './mouth.js';

type Opts = Parameters<typeof createController>[0];

function setup(over: Partial<Opts> = {}) {
  document.body.innerHTML = '<canvas id="kira-avatar"></canvas><span id="kira-avatar-loading" hidden></span>';
  const canvas = document.getElementById('kira-avatar') as HTMLCanvasElement;
  const target = new EventTarget();
  const stage = { dispose: vi.fn() };
  const startStage = vi.fn().mockResolvedValue(stage);
  const fetchModel = vi.fn(async (_t: string, p: (f: number | null) => void) => { p(0.5); return new ArrayBuffer(4); });
  const mouth = new Mouth(() => 0.5);
  createController({ target, canvas, fetchModel, startStage, mouth, now: () => 0, ...over } as Opts);
  const auth = (token: string | null) => target.dispatchEvent(new CustomEvent('kira:auth', { detail: { token } }));
  const flush = () => new Promise(r => setTimeout(r, 0));
  return { canvas, target, stage, startStage, fetchModel, mouth, auth, flush };
}

describe('avatar controller', () => {
  it('does nothing before auth', () => {
    const s = setup();
    expect(s.fetchModel).not.toHaveBeenCalled();
    expect(s.canvas.dataset.avatarStatus).toBe('idle');
  });

  it('loads the model after auth and reports ready', async () => {
    const s = setup();
    s.auth('tok');
    expect(s.canvas.dataset.avatarStatus).toBe('loading');
    await s.flush();
    expect(s.fetchModel).toHaveBeenCalledWith('tok', expect.any(Function));
    expect(s.startStage).toHaveBeenCalledTimes(1);
    expect(s.canvas.dataset.avatarStatus).toBe('ready');
    expect(document.getElementById('kira-avatar-loading')!.hidden).toBe(true);
  });

  it('shows progress in the loading element', async () => {
    let release!: () => void;
    const s = setup({
      fetchModel: (async (_t: string, p: (f: number | null) => void) => {
        p(0.42);
        await new Promise<void>(r => { release = r; });
        return new ArrayBuffer(1);
      }) as never,
    });
    s.auth('tok');
    await s.flush();
    const el = document.getElementById('kira-avatar-loading')!;
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain('42');
    release();
    await s.flush();
  });

  it('falls back quietly on 401 and 404', async () => {
    for (const status of [401, 404]) {
      const s = setup({ fetchModel: vi.fn().mockRejectedValue(new ModelError(status)) as never });
      s.auth('tok');
      await s.flush();
      expect(s.canvas.dataset.avatarStatus).toBe('unavailable');
      expect(s.canvas.hidden).toBe(true);
      expect(s.startStage).not.toHaveBeenCalled();
    }
  });

  it('falls back when the stage cannot start (no WebGL)', async () => {
    const s = setup({ startStage: vi.fn().mockRejectedValue(new Error('webgl')) as never });
    s.auth('tok');
    await s.flush();
    expect(s.canvas.dataset.avatarStatus).toBe('unavailable');
  });

  it('disposes on unpair and ignores a stale in-flight load', async () => {
    const s = setup();
    s.auth('tok');
    await s.flush();
    s.auth(null);
    expect(s.stage.dispose).toHaveBeenCalled();
    expect(s.canvas.dataset.avatarStatus).toBe('idle');

    let resolveModel!: (b: ArrayBuffer) => void;
    const s2 = setup({ fetchModel: (() => new Promise<ArrayBuffer>(r => { resolveModel = r; })) as never });
    s2.auth('tok');
    s2.auth(null);
    resolveModel(new ArrayBuffer(1));
    await s2.flush();
    expect(s2.startStage).not.toHaveBeenCalled();
  });

  it('does not reload for a repeated token', async () => {
    const s = setup();
    s.auth('tok');
    await s.flush();
    s.auth('tok');
    await s.flush();
    expect(s.fetchModel).toHaveBeenCalledTimes(1);
  });

  it('drives the mouth from speech events', () => {
    const s = setup();
    s.target.dispatchEvent(new CustomEvent('kira:speech', { detail: { phase: 'start' } }));
    expect(s.mouth.speaking).toBe(true);
    s.target.dispatchEvent(new CustomEvent('kira:speech', { detail: { phase: 'end' } }));
    expect(s.mouth.speaking).toBe(false);
  });
});

describe('avatar controller degraded textures', () => {
  it('marks the canvas degraded when the stage reports a texture failure', async () => {
    const stage = { dispose: vi.fn() };
    const startStage = vi.fn(async (_c: unknown, _m: unknown, inputs: { onDegraded?: () => void }) => {
      inputs.onDegraded?.();
      return stage;
    });
    document.body.innerHTML = '<canvas id="kira-avatar"></canvas><span id="kira-avatar-loading" hidden></span>';
    const canvas = document.getElementById('kira-avatar') as HTMLCanvasElement;
    const target = new EventTarget();
    createController({
      target, canvas, mouth: new Mouth(() => 0.5), now: () => 0,
      fetchModel: async () => new ArrayBuffer(4), startStage: startStage as never,
    });
    target.dispatchEvent(new CustomEvent('kira:auth', { detail: { token: 't' } }));
    await new Promise(r => setTimeout(r, 0));
    expect(canvas.dataset.avatarStatus).toBe('degraded');
    expect(canvas.hidden).toBe(false);
  });
});
