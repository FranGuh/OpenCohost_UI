import { render, waitFor } from '@testing-library/react';
import { Scene, Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { VrmStage } from './VrmStage.js';
import { vrmDiagnostics } from '../domain/vrmDiagnostics.js';
const fakes = vi.hoisted(() => ({ dispose: vi.fn(), load: vi.fn(), play: vi.fn(), tick: vi.fn(), log: [] as string[] }));
vi.mock('../domain/vrmLoader.js', () => ({
  loadVrm: fakes.load, disposeVrm: fakes.dispose, portraitTarget: vi.fn(), portraitFraming: vi.fn(),
  calculateFraming: (_vrm: unknown, mode: string) => { fakes.log.push(`frame:${mode}`); return { target: new Vector3(), distance: 2 }; },
}));
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class { setClearColor() {} setPixelRatio() {} setSize() {} render() {} dispose() {} forceContextLoss() {} shadowMap = { enabled: false, type: 0 }; } };
});
it('prevents context loss and disposes a late model after teardown', async () => {
  let resolve!: (value: unknown) => void;
  fakes.load.mockImplementation(() => new Promise(r => { resolve = r; }));
  const onError = vi.fn();
  const view = render(<VrmStage url="model" sample={() => 0} onError={onError} />);
  const event = new Event('webglcontextlost', { cancelable: true });
  view.container.querySelector('canvas')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('WebGL context lost'));
  const oldResolve = resolve;
  view.container.querySelector('canvas')!.dispatchEvent(new Event('webglcontextrestored'));
  expect(fakes.load).toHaveBeenCalledTimes(2);
  oldResolve({ obsolete: true });
  view.unmount(); const model = {}; resolve(model);
  await waitFor(() => expect(fakes.dispose).toHaveBeenCalledWith(model));
});

it('does not reload model when sample or onError identity changes on rerender', async () => {
  fakes.load.mockReset();
  fakes.load.mockResolvedValue({ scene: new Scene() });
  const view = render(<VrmStage url="model-stable.vrm" sample={() => 0} onError={() => {}} />);
  await waitFor(() => expect(fakes.load).toHaveBeenCalledTimes(1));

  view.rerender(<VrmStage url="model-stable.vrm" sample={() => 1} onError={() => {}} />);
  expect(fakes.load).toHaveBeenCalledTimes(1);

  // Changing url DOES reload model
  view.rerender(<VrmStage url="model-new.vrm" sample={() => 1} onError={() => {}} />);
  await waitFor(() => expect(fakes.load).toHaveBeenCalledTimes(2));
});

vi.mock('../domain/vrmAnimator.js', () => ({ VRMA_PATHS: { SMARTPHONE: '/phone.vrma' }, animator: () => Object.assign(vi.fn((...args: unknown[]) => { fakes.log.push('tick'); fakes.tick(...args); }), { playCustomAnimation: fakes.play, dispose: vi.fn() }) }));
it('does not route a completed old animation into the latest QA callback', async () => {
  fakes.load.mockResolvedValue({ scene: new Scene() }); fakes.play.mockReset();
  const first = vi.fn(), second = vi.fn();
  const view = render(<VrmStage url="qa.vrm" sample={() => 0} onError={() => {}} qaAnimationUrl="first" onQaAnimationFinished={first} />);
  await waitFor(() => expect(fakes.play).toHaveBeenCalled());
  const obsolete = fakes.play.mock.calls[fakes.play.mock.calls.length - 1][1] as () => void;
  view.rerender(<VrmStage url="qa.vrm" sample={() => 0} onError={() => {}} qaAnimationUrl="second" onQaAnimationFinished={second} />);
  obsolete();
  expect(second).not.toHaveBeenCalled();
  view.unmount();
});

it('sets frustumCulled false on VRM meshes to prevent disappearing geometry during animations', async () => {
  const { Mesh } = await import('three');
  const dummyMesh = new Mesh();
  dummyMesh.frustumCulled = true;
  const dummyScene = new Scene();
  dummyScene.add(dummyMesh);

  fakes.load.mockResolvedValue({ scene: dummyScene });
  const view = render(<VrmStage url="mesh-test.vrm" sample={() => 0} onError={() => {}} />);
  await waitFor(() => expect(fakes.load).toHaveBeenCalled());

  expect(dummyMesh.frustumCulled).toBe(false);
  view.unmount();
});


// ---------------------------------------------------------------------------
// Framing never sticks on a stale pose (bind pose or pre-suspend camera).
// ---------------------------------------------------------------------------

function installManualRaf() {
  let queue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextId = 1;
  let clock = performance.now();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; queue.push({ id, cb }); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue = queue.filter(entry => entry.id !== id); });
  const size = { configurable: true, get: () => 200 };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', size);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', size);
  return {
    pending: () => queue.length,
    // Virtual clock: each flush advances 100 ms (past any frame budget) unless `advanceMs` says otherwise.
    flush: (advanceMs = 100) => { clock += advanceMs; const batch = queue; queue = []; batch.forEach(entry => entry.cb(clock)); },
  };
}

it('forwards clip activity separately from waveform sample to the animator', async () => {
  const raf = installManualRaf();
  fakes.tick.mockClear();
  fakes.load.mockResolvedValue({ scene: new Scene() });
  let audioActive = false;
  const view = render(<VrmStage url="audio-gate.vrm" sample={() => 0} isAudioActive={() => audioActive} onError={() => {}} state="speaking" />);
  await waitFor(() => expect(raf.pending()).toBe(1));
  raf.flush();
  expect(fakes.tick.mock.calls[fakes.tick.mock.calls.length - 1]?.[4]).toBe(false);
  audioActive = true;
  raf.flush();
  expect(fakes.tick.mock.calls[fakes.tick.mock.calls.length - 1]?.[4]).toBe(true);
  view.unmount();
});

it('omits diagnostic frame ids and callbacks until capture is explicitly enabled', async () => {
  const raf = installManualRaf();
  fakes.tick.mockClear(); fakes.load.mockResolvedValue({ scene: new Scene() });
  const sample = vi.fn((_frameId?: number, _dtSeconds?: number) => 0.4);
  const view = render(<VrmStage url="diagnostics-off.vrm" sample={sample} onError={() => {}} />);
  await waitFor(() => expect(raf.pending()).toBe(1));
  raf.flush();

  expect(sample).toHaveBeenCalledTimes(1);
  expect(sample.mock.calls[0]?.[0]).toBeUndefined();
  expect(sample.mock.calls[0]?.[1]).toBeCloseTo(0.1, 1);
  const call = fakes.tick.mock.calls[fakes.tick.mock.calls.length - 1]!;
  expect(call[5]).toBeUndefined();
  expect(call[6]).toBeUndefined();
  view.unmount();
});

it('correlates opted-in sampled and final-gate records with the surface and frame id', async () => {
  const raf = installManualRaf();
  fakes.tick.mockClear(); fakes.load.mockResolvedValue({ scene: new Scene() });
  vrmDiagnostics.clear(); vrmDiagnostics.start('piper');
  const sample = vi.fn((frameId?: number, _deltaSeconds?: number) => {
    vrmDiagnostics.recordSample('desktop-companion', frameId, 7, true, 0.3, 1, 0.4);
    return 0.4;
  });
  const view = render(<VrmStage url="diagnostics-on.vrm" sample={sample} onError={() => {}} state="speaking" diagnosticSurface="desktop-companion" />);
  await waitFor(() => expect(raf.pending()).toBe(1));
  raf.flush();

  const [,, state,, audioActive, observer, frameId, surface] = fakes.tick.mock.calls[fakes.tick.mock.calls.length - 1]!;
  expect(sample).toHaveBeenCalledTimes(1);
  expect(sample.mock.calls[0]?.[0]).toBe(1);
  expect(sample.mock.calls[0]?.[1]).toBeCloseTo(0.1, 1);
  expect(state).toBe('speaking');
  expect(audioActive).toBe(false);
  expect(surface).toBe('desktop-companion');
  expect(typeof observer).toBe('function');
  (observer as (surface: string, frameId: number, inputMouth: number, audioActive: boolean, state: string,
    activeMouth: number, mouthOpen: number, aa: number, oh: number, gateReason: string) => void)(
    surface as string, frameId as number, 0.4, false, 'speaking', 0, 0, 0, 0, 'audio_inactive',
  );
  expect(vrmDiagnostics.read()).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'sample', surface: 'desktop-companion', providerTag: 'piper', frameId: 1, sequence: 7, rms: 0.3 }),
    expect.objectContaining({ kind: 'frame', surface: 'desktop-companion', providerTag: 'piper', frameId: 1, gateReason: 'audio_inactive', aa: 0, oh: 0 }),
  ]));
  view.unmount(); vrmDiagnostics.stop(); vrmDiagnostics.clear();
});

afterEach(() => {
  vrmDiagnostics.stop();
  vrmDiagnostics.clear();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

it('re-applies framing once after the first animated tick so the bind-pose framing never sticks', async () => {
  const raf = installManualRaf();
  fakes.log.length = 0;
  fakes.load.mockReset();
  fakes.load.mockResolvedValue({ scene: new Scene() });
  const view = render(<VrmStage url="framing.vrm" sample={() => 0} onError={() => {}} framingMode="head" />);
  await waitFor(() => expect(raf.pending()).toBe(1));
  expect(fakes.log).toEqual(['frame:head']);

  raf.flush();
  expect(fakes.log).toEqual(['frame:head', 'tick', 'frame:head']);

  raf.flush();
  expect(fakes.log).toEqual(['frame:head', 'tick', 'frame:head', 'tick']);
  view.unmount();
});

it('re-frames from live bones and resumes the loop when the stage is reactivated', async () => {
  const raf = installManualRaf();
  fakes.log.length = 0;
  fakes.load.mockReset();
  fakes.load.mockResolvedValue({ scene: new Scene() });
  const view = render(<VrmStage url="resume.vrm" sample={() => 0} onError={() => {}} active framingMode="half" />);
  await waitFor(() => expect(raf.pending()).toBe(1));
  raf.flush();
  raf.flush();

  view.rerender(<VrmStage url="resume.vrm" sample={() => 0} onError={() => {}} active={false} framingMode="half" />);
  raf.flush();
  expect(raf.pending()).toBe(0);
  fakes.log.length = 0;

  view.rerender(<VrmStage url="resume.vrm" sample={() => 0} onError={() => {}} active framingMode="half" />);
  expect(raf.pending()).toBe(1);
  raf.flush();
  expect(fakes.log).toEqual(['tick', 'frame:half']);
  expect(raf.pending()).toBe(1);
  view.unmount();
});

it('plays the smartphone clip while looking and releases it when speaking starts', async () => {
  fakes.load.mockResolvedValue({ scene: new Scene() }); fakes.play.mockReset();
  const view = render(<VrmStage url="look.vrm" sample={() => 0} onError={() => {}} state="idle" looking />);
  await waitFor(() => expect(fakes.play).toHaveBeenCalledWith('/phone.vrma', expect.anything(), { hold: true }));
  view.rerender(<VrmStage url="look.vrm" sample={() => 0} onError={() => {}} state="speaking" looking />);
  await waitFor(() => expect(fakes.play).toHaveBeenLastCalledWith(null, expect.any(Function), { hold: false }));
  view.unmount();
});

it('renders at 60 fps while active and passes the real elapsed dt', async () => {
  const raf = installManualRaf();
  fakes.tick.mockClear();
  fakes.load.mockReset();
  fakes.load.mockResolvedValue({ scene: new Scene() });
  const view = render(<VrmStage url="budget.vrm" sample={() => 0} onError={() => {}} state="speaking" />);
  await waitFor(() => expect(raf.pending()).toBe(1));
  raf.flush(100);
  expect(fakes.tick).toHaveBeenCalledTimes(1);
  raf.flush(7);
  expect(fakes.tick).toHaveBeenCalledTimes(1);
  raf.flush(9);
  expect(fakes.tick).toHaveBeenCalledTimes(2);
  expect(fakes.tick.mock.calls[1]?.[0]).toBeCloseTo(0.016, 3);
  expect(raf.pending()).toBe(1);
  view.unmount();
});

it('renders at 30 fps while idle', async () => {
  const raf = installManualRaf();
  fakes.tick.mockClear();
  fakes.load.mockReset();
  fakes.load.mockResolvedValue({ scene: new Scene() });
  const view = render(<VrmStage url="idle.vrm" sample={() => 0} onError={() => {}} state="idle" />);
  await waitFor(() => expect(raf.pending()).toBe(1));
  raf.flush(100);
  raf.flush(20);
  expect(fakes.tick).toHaveBeenCalledTimes(1);
  raf.flush(15);
  expect(fakes.tick).toHaveBeenCalledTimes(2);
  view.unmount();
});
