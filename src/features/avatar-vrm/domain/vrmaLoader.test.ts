import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearVrmaCache, loadRawVrma, loadVrmaClip, loadVrmaClipSafe } from './vrmaLoader.js';
import { NumberKeyframeTrack, QuaternionKeyframeTrack, Vector3, type Object3D } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';

const mockLoadAsync = vi.fn();
vi.mock('three/addons/loaders/GLTFLoader.js', () => {
  return {
    GLTFLoader: class {
      register() {}
      loadAsync(url: string) {
        return mockLoadAsync(url);
      }
    },
  };
});

const mockCreateClip = vi.fn();
vi.mock('@pixiv/three-vrm-animation', async importOriginal => {
  const actual = await importOriginal<typeof import('@pixiv/three-vrm-animation')>();
  return {
    ...actual,
    VRMAnimationLoaderPlugin: class { constructor() {} },
    createVRMAnimationClip: (...args: unknown[]) => mockCreateClip(...args),
  };
});

describe('vrmaLoader', () => {
  beforeEach(() => {
    clearVrmaCache();
    mockLoadAsync.mockReset();
    mockCreateClip.mockReset();
  });

  it('loads and caches raw VRMAnimation instances by url', async () => {
    const fakeVrmAnimation = { duration: 3.5, restHipsPosition: new Vector3() } as unknown as VRMAnimation;
    mockLoadAsync.mockResolvedValue({
      userData: {
        vrmAnimations: [fakeVrmAnimation],
      },
    });

    const first = await loadRawVrma('/test.vrma');
    const second = await loadRawVrma('/test.vrma');

    expect(first).toBe(fakeVrmAnimation);
    expect(second).toBe(fakeVrmAnimation);
    expect(mockLoadAsync).toHaveBeenCalledTimes(1);
  });

  it('throws when gltf does not contain vrmAnimations', async () => {
    mockLoadAsync.mockResolvedValue({ userData: {} });
    await expect(loadRawVrma('/empty.vrma')).rejects.toThrow('No VRMAnimation found in /empty.vrma');
  });

  it('clears cache on demand', async () => {
    const fakeVrmAnimation = { duration: 1.0 } as unknown as VRMAnimation;
    mockLoadAsync.mockResolvedValue({ userData: { vrmAnimations: [fakeVrmAnimation] } });

    await loadRawVrma('/cached.vrma');
    clearVrmaCache();
    await loadRawVrma('/cached.vrma');

    expect(mockLoadAsync).toHaveBeenCalledTimes(2);
  });

  it('filters expression tracks (.weight) and preserves humanoid skeletal tracks', async () => {
    const fakeVrmAnimation = { duration: 2.0 } as unknown as VRMAnimation;
    mockLoadAsync.mockResolvedValue({ userData: { vrmAnimations: [fakeVrmAnimation] } });

    // Track 1: arm rotation (humanoid skeleton)
    const boneTrack = new QuaternionKeyframeTrack('J_Bip_C_Chest.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    // Track 2: blink/expression weight (should be filtered out)
    const expressionTrack = new NumberKeyframeTrack('VRMExpression_blink.weight', [0, 1], [0, 1]);

    mockCreateClip.mockReturnValue({
      name: 'vrma_motion',
      duration: 2.0,
      tracks: [boneTrack, expressionTrack],
    });

    const dummyVrm = {
      humanoid: { getNormalizedBoneNode: () => null },
      meta: { metaVersion: '0' },
    } as unknown as VRM;

    const clip = await loadVrmaClip('/motion.vrma', dummyVrm);
    expect(clip.duration).toBe(2.0);
    expect(clip.tracks).toHaveLength(1);
    expect(clip.tracks[0].name).toBe('J_Bip_C_Chest.quaternion');
  });

  it('strips VRMLookAtQuaternionProxy and eye rotation tracks to preserve OpenCohost gaze authority', async () => {
    const fakeVrmAnimation = { duration: 2.0 } as unknown as VRMAnimation;
    mockLoadAsync.mockResolvedValue({ userData: { vrmAnimations: [fakeVrmAnimation] } });

    const spineTrack = new QuaternionKeyframeTrack('J_Bip_C_Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const lookAtProxyTrack = new QuaternionKeyframeTrack('VRMLookAtQuaternionProxy.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const leftEyeTrack = new QuaternionKeyframeTrack('leftEye.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const rightEyeTrack = new QuaternionKeyframeTrack('rightEye.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);

    mockCreateClip.mockReturnValue({
      name: 'vrma_gaze_motion',
      duration: 2.0,
      tracks: [spineTrack, lookAtProxyTrack, leftEyeTrack, rightEyeTrack],
    });

    const dummyVrm = {
      humanoid: { getNormalizedBoneNode: () => null },
      meta: { metaVersion: '0' },
    } as unknown as VRM;

    const clip = await loadVrmaClip('/gaze_motion.vrma', dummyVrm);
    expect(clip.tracks).toHaveLength(1);
    expect(clip.tracks[0].name).toBe('J_Bip_C_Spine.quaternion');
  });

  it('safe loader returns null on failure without throwing', async () => {
    mockLoadAsync.mockRejectedValue(new Error('Network 404'));
    const dummyVrm = { meta: { metaVersion: '0' } } as unknown as VRM;

    const clip = await loadVrmaClipSafe('/missing.vrma', dummyVrm);
    expect(clip).toBeNull();
  });
});
