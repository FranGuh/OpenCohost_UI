import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationClip, Object3D, Quaternion, Vector3, VectorKeyframeTrack } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { animator, CLIP_FALLBACKS, resetUnavailableClips, VRMA_PATHS } from './vrmAnimator.js';

const mockLoadClipSafe = vi.fn();
vi.mock('./vrmaLoader.js', () => ({
  loadVrmaClipSafe: (...args: unknown[]) => mockLoadClipSafe(...args),
  resolveAnimationUrl: (p: string) => p,
}));

const clip = (name: string, d = 2) =>
  new AnimationClip(name, d, [new VectorKeyframeTrack('hips.position', [0, d], [0, 0, 0, 0, 0.1, 0])]);

function dummyVrm(): VRM {
  const scene = new Object3D();
  const hips = new Object3D();
  hips.name = 'hips';
  scene.add(hips);
  const head = new Object3D();
  scene.add(head);
  return {
    scene,
    humanoid: { getNormalizedBoneNode: (n: string) => (n === 'hips' ? hips : n === 'head' ? head : null) },
    lookAt: {
      target: null, autoUpdate: true,
      getLookAtWorldPosition: (t: Vector3) => head.getWorldPosition(t),
      getLookAtWorldQuaternion: (t: Quaternion) => head.getWorldQuaternion(t),
      getFaceFrontQuaternion: (t: Quaternion) => t.identity(),
      update: vi.fn(),
    },
    expressionManager: { setValue: vi.fn() },
    update: vi.fn(),
  } as unknown as VRM;
}

const isPixiv = (u: string) => /\/VRMA_\d+\.vrma$/.test(u);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('VRMA_* (pixiv, not distributed) fallback to CC0 clips', () => {
  beforeEach(() => {
    mockLoadClipSafe.mockReset();
    resetUnavailableClips();
  });

  it('maps every pixiv clip path to a CC0 001..008 clip', () => {
    const pixiv = Object.values(VRMA_PATHS).filter(isPixiv);
    expect(pixiv.length).toBeGreaterThan(0);
    for (const url of pixiv) {
      expect(CLIP_FALLBACKS[url]).toMatch(/^\/animations\/00[1-8]_[a-z_0-9]+\.vrma$/);
    }
  });

  it('loads the CC0 clip for each logical motion when the pixiv files are missing, without retrying', async () => {
    mockLoadClipSafe.mockImplementation(async (url: string) => (isPixiv(url) ? null : clip(url)));
    const a = animator(dummyVrm(), () => 0.5);
    await flush();
    const calls = mockLoadClipSafe.mock.calls.map(c => c[0] as string);
    expect(calls).toContain(CLIP_FALLBACKS[VRMA_PATHS.GREETING]);
    expect(calls).toContain(CLIP_FALLBACKS[VRMA_PATHS.SHOOT]);
    for (const url of new Set(calls.filter(isPixiv))) {
      expect(calls.filter(c => c === url).length).toBe(1);
    }
    a.dispose();

    // A second avatar must not request the known-missing files again (no 404 loop).
    mockLoadClipSafe.mockClear();
    const b = animator(dummyVrm(), () => 0.5);
    await flush();
    expect(mockLoadClipSafe.mock.calls.map(c => c[0] as string).filter(isPixiv)).toEqual([]);
    b.dispose();
  });

  it('keeps using the pixiv clip when it is present (no fallback load)', async () => {
    mockLoadClipSafe.mockImplementation(async (url: string) => clip(url));
    const a = animator(dummyVrm(), () => 0.5);
    await flush();
    const calls = mockLoadClipSafe.mock.calls.map(c => c[0] as string);
    expect(calls).toContain(VRMA_PATHS.SHOOT);
    expect(calls).not.toContain(CLIP_FALLBACKS[VRMA_PATHS.SHOOT]);
    a.dispose();
  });
});
