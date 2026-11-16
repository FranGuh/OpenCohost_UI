import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationClip, NumberKeyframeTrack, Object3D, Vector3 } from 'three';
import * as runtime from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import { animator, resetUnavailableClips, VRMA_PATHS } from './vrmAnimator.js';
const load = vi.hoisted(() => vi.fn());
vi.mock('./vrmaLoader.js', () => ({ loadVrmaClipSafe: load }));
const { VRMLookAt } = runtime as unknown as { VRMLookAt: new (...args: any[]) => any };
function fixture(front = 1) {
  const scene = new Object3D();
  const head = new Object3D(); head.name = 'head'; head.position.y = 1.5; scene.add(head);
  const humanoid = { getNormalizedBoneNode: (n: string) => n === 'head' ? head : null,
    getRawBoneNode: (n: string) => n === 'head' ? head : null, update: () => scene.updateMatrixWorld(true) };
  scene.updateMatrixWorld(true);
  const lookAt = new VRMLookAt(humanoid, { applyYawPitch: vi.fn() });
  lookAt.faceFront.set(0, 0, front);
  const expressions = new Map<string, number>();
  const expressionManager = { setValue: (name: string, value: number) => expressions.set(name, value) };
  const vrm = { scene, humanoid, lookAt, expressionManager, update: (dt: number) => { humanoid.update(); lookAt.update(dt); } } as unknown as VRM;
  return { vrm, head, lookAt, expressions };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const pose = (name: string, value = 0.8, duration = 2) => new AnimationClip(name, duration, [new NumberKeyframeTrack('head.rotation[x]', [0, duration], [value, value])]);
beforeEach(() => { resetUnavailableClips(); vi.useFakeTimers(); load.mockReset().mockResolvedValue(null); });
afterEach(() => vi.useRealTimers());
describe('custom animation ownership', () => {
  it.each(['replace', 'cancel', 'dispose'])('does not finish on %s', async (mode) => {
    const { vrm } = fixture(); const tick = animator(vrm); await flush();
    load.mockResolvedValue(pose('gesture')); const done = vi.fn();
    await tick.playCustomAnimation('/gesture', done);
    if (mode === 'dispose') tick.dispose();
    else await tick.playCustomAnimation(mode === 'cancel' ? null : '/next');
    await vi.advanceTimersByTimeAsync(6000);
    expect(done).not.toHaveBeenCalled(); tick.dispose();
  });
  it('finishes once naturally and not again at timeout', async () => {
    const { vrm } = fixture(); const tick = animator(vrm); await flush();
    load.mockResolvedValue(pose('gesture')); const done = vi.fn(); await tick.playCustomAnimation('/gesture', done);
    for (let i = 0; i < 50; i++) tick(0.05, 0);
    expect(done).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(6000);
    expect(done).toHaveBeenCalledTimes(1); tick.dispose();
  });
  it('holds a hold-mode clip on its last frame past the clip end and the timeout', async () => {
    const { vrm, head } = fixture(); const tick = animator(vrm); await flush();
    load.mockResolvedValue(pose('hold')); const done = vi.fn();
    await tick.playCustomAnimation('/hold', done, { hold: true });
    for (let i = 0; i < 80; i++) tick(0.05, 0);
    await vi.advanceTimersByTimeAsync(6000);
    for (let i = 0; i < 10; i++) tick(0.05, 0);
    expect(done).not.toHaveBeenCalled();
    expect(head.rotation.x).toBeCloseTo(0.8, 3);
    await tick.playCustomAnimation(null);
    for (let i = 0; i < 40; i++) tick(0.05, 0);
    expect(head.rotation.x).toBeLessThan(0.8); tick.dispose();
  });
  it.each(['cancel', 'dispose', 'replace'])('drops a late loader after %s', async (mode) => {
    const { vrm, head } = fixture(); const tick = animator(vrm); await flush();
    let resolve!: (clip: AnimationClip) => void;
    load.mockImplementation(() => new Promise<AnimationClip>(r => { resolve = r; }));
    const done = vi.fn(); const pending = tick.playCustomAnimation('/late', done);
    if (mode === 'dispose') tick.dispose();
    else { load.mockResolvedValue(pose('new', 0.1)); await tick.playCustomAnimation(mode === 'cancel' ? null : '/new'); }
    resolve(pose('late')); await pending; await vi.advanceTimersByTimeAsync(6000);
    expect(done).not.toHaveBeenCalled();
    if (mode !== 'dispose') { tick(0.05, 0); expect(head.rotation.x).toBeLessThan(0.3); }
    tick.dispose();
  });
});
describe('pose-relative gaze', () => {
  it.each([1, -1])('keeps solver neutral through a bow with faceFront %s and transformed scene', async front => {
    const { vrm, head, lookAt } = fixture(front); const tick = animator(vrm); await flush();
    vrm.scene.position.set(2, 1, -3); vrm.scene.rotation.y = Math.PI / 2;
    load.mockResolvedValue(pose('bow')); await tick.playCustomAnimation('/bow');
    for (let i = 0; i < 15; i++) tick(0.05, 0, 'speaking', { x: 1, y: 1, active: true });
    expect(head.rotation.x).toBeCloseTo(0.8, 5);
    expect(lookAt.yaw).toBeCloseTo(0, 5); expect(lookAt.pitch).toBeCloseTo(0, 5); tick.dispose();
  });
  it('does not subtract the prior offset from a fresh keyed mixer pose', async () => {
    const { vrm, head } = fixture(); const tick = animator(vrm); await flush();
    load.mockResolvedValue(pose('idle', 0.1)); await tick.playCustomAnimation(VRMA_PATHS.BASE_IDLE);
    for (let i = 0; i < 30; i++) tick(0.05, 0, 'listening');
    expect(head.rotation.x).toBeCloseTo(0.15, 3); tick.dispose();
  });
});

it('keeps a base idle available when QA starts before preload finishes', async () => {
  let release!: (value: null) => void;
  load.mockImplementation((url: string) => url === VRMA_PATHS.GREETING
    ? new Promise<null>(r => { release = r; })
    : Promise.resolve(url === VRMA_PATHS.BASE_IDLE ? pose('idle', 0.1) : pose(url, 0.8)));
  const { vrm, head } = fixture(); const tick = animator(vrm, () => 0.5);
  await tick.playCustomAnimation('/early'); release(null); await flush();
  await tick.playCustomAnimation(null);
  for (let i = 0; i < 20; i++) tick(0.05, 0, 'listening');
  expect(head.rotation.x).toBeCloseTo(0.15, 2); tick.dispose();
});

it('reports the exact mouth gate and final aa/oh values without changing the expression output', async () => {
  const { vrm, expressions } = fixture(); const tick = animator(vrm); await flush();
  const observe = vi.fn();

  tick(0.016, 0.5, 'speaking', undefined, false, observe, 41, 'main');
  expect(expressions.get('aa')).toBe(0);
  expect(expressions.get('oh')).toBe(0);
  expect(observe).toHaveBeenLastCalledWith('main', 41, 0.5, false, 'speaking', 0, 0, 0, 0, 'audio_inactive');

  tick(0.016, 0.5, 'speaking', undefined, true, observe, 42, 'main');
  expect(expressions.get('aa')).toBe(0.5);
  expect(expressions.get('oh')).toBe(0.1);
  expect(observe).toHaveBeenLastCalledWith('main', 42, 0.5, true, 'speaking', 0.5, 0.5, 0.5, 0.1, 'open');
  tick.dispose();
});

it('renders a small positive mouth opening while its audio source is still active', async () => {
  const { vrm, expressions } = fixture(); const tick = animator(vrm); await flush();

  tick(0.016, 0.02, 'speaking', undefined, true);

  expect(expressions.get('aa')).toBe(0.02);
  expect(expressions.get('oh')).toBe(0.004);
  tick.dispose();
});
