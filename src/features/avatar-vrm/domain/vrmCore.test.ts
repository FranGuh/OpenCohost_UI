import { describe, expect, it } from 'vitest';
import { animator, clampDelta, rms } from './vrmAnimator.js';
import { disposeVrm, portraitFraming } from './vrmLoader.js';
import { Object3D } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { localBackend } from './vrmApi.js';

describe('VRM safety boundaries', () => {
  it('uses the installed runtime disposal utility', () => {
    expect(() => disposeVrm({ scene: new Object3D() } as VRM)).not.toThrow();
  });
  it('passes the clamped dt to physics and does not accumulate breathing drift', () => {
    const deltas: number[] = [];
    const bone = new Object3D(); bone.rotation.x = 0.4;
    const tick = animator({ humanoid: { getNormalizedBoneNode: () => bone }, update: (dt: number) => deltas.push(dt) } as unknown as VRM);
    for (let i = 0; i < 100; i++) tick(2, 0);
    expect(deltas.every(dt => dt === 0.05)).toBe(true);
    expect(Math.abs(bone.rotation.x - 0.4)).toBeLessThanOrEqual(0.012);
  });
  it('clamps dropped frames and invalid clock values', () => {
    expect(clampDelta(1)).toBe(0.05);
    expect(clampDelta(-1)).toBe(0);
    expect(clampDelta(NaN)).toBe(0);
    expect(clampDelta(0.01)).toBe(0.01);
  });
  it('uses time domain RMS, not frequency averages', () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(rms(new Float32Array(4))).toBe(0);
  });
  it('never sends credentials to remote or credential-bearing URLs', () => {
    expect(localBackend('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765');
    for (const url of ['https://evil.test', 'http://user@localhost:8765', 'http://localhost/path', 'http://localhost?token=x']) {
      expect(() => localBackend(url)).toThrow();
    }
  });
  it('positions arms into natural resting posture out of T-pose', () => {
    const chest = new Object3D();
    const leftUpperArm = new Object3D();
    const rightUpperArm = new Object3D();
    const leftLowerArm = new Object3D();
    const rightLowerArm = new Object3D();
    const leftHand = new Object3D();
    const rightHand = new Object3D();
    const bones: Record<string, Object3D> = {
      chest,
      leftUpperArm,
      rightUpperArm,
      leftLowerArm,
      rightLowerArm,
      leftHand,
      rightHand,
    };
    const vrm = {
      humanoid: {
        getNormalizedBoneNode: (name: string) => bones[name] ?? null,
      },
      update: () => {},
    } as unknown as VRM;

    const tick = animator(vrm);
    tick(0.016, 0, 'idle');

    expect(leftUpperArm.rotation.z).toBeGreaterThan(1.0);
    expect(rightUpperArm.rotation.z).toBeLessThan(-1.0);
    expect(leftLowerArm.rotation.y).toBeGreaterThan(0);
    expect(rightLowerArm.rotation.y).toBeLessThan(0);
    expect(leftHand.rotation.y).toBeGreaterThan(0);
    expect(rightHand.rotation.y).toBeLessThan(0);
  });
  it('triggers subtle conversational arm and hand gestures when speaking', () => {
    const leftUpperArm = new Object3D();
    const rightUpperArm = new Object3D();
    const leftLowerArm = new Object3D();
    const rightLowerArm = new Object3D();
    const leftHand = new Object3D();
    const rightHand = new Object3D();
    const bones: Record<string, Object3D> = {
      leftUpperArm,
      rightUpperArm,
      leftLowerArm,
      rightLowerArm,
      leftHand,
      rightHand,
    };
    const vrm = {
      humanoid: {
        getNormalizedBoneNode: (name: string) => bones[name] ?? null,
      },
      update: () => {},
    } as unknown as VRM;

    // Fixed random: returns 0.1 so nextGestureTime = 6 + 0.1*8 = 6.8s, gesture = explain_right
    const tick = animator(vrm, () => 0.1);
    // Advance to 8.4 seconds (6.8s trigger + ~1.6s peak)
    for (let i = 0; i < 170; i++) {
      tick(0.05, 0.4, 'speaking');
    }

    // At peak of explain_right, right forearm lifts forward (x > 0.1) and right hand tilts
    expect(rightLowerArm.rotation.x).toBeGreaterThan(0.1);
    expect(rightUpperArm.rotation.z).toBeGreaterThan(-1.2);
    expect(rightHand.rotation.x).toBeGreaterThan(0.06);
  });
  it('suppresses arm gestures during sleep', () => {
    const rightLowerArm = new Object3D();
    const bones: Record<string, Object3D> = { rightLowerArm };
    const vrm = {
      humanoid: {
        getNormalizedBoneNode: (name: string) => bones[name] ?? null,
      },
      update: () => {},
    } as unknown as VRM;

    const tick = animator(vrm, () => 0.1);
    for (let i = 0; i < 200; i++) {
      tick(0.05, 0, 'sleeping');
    }

    // Right lower arm stays at rest during sleep (x === 0, no lift gesture)
    expect(rightLowerArm.rotation.x).toBe(0);
  });
  it('closes eyes and relaxes posture when sleeping', () => {
    const expressions: Record<string, number> = {};
    const vrm = {
      humanoid: { getNormalizedBoneNode: () => null },
      expressionManager: {
        setValue: (name: string, val: number) => {
          expressions[name] = val;
        },
      },
      update: () => {},
    } as unknown as VRM;

    const tick = animator(vrm);
    for (let i = 0; i < 20; i++) tick(0.05, 0, 'sleeping');

    expect(expressions['blink']).toBeGreaterThan(0.9);
    expect(expressions['relaxed']).toBeGreaterThan(0.5);
    expect(expressions['happy']).toBe(0);
  });
  it('drives lip sync and blends happy expression when speaking', () => {
    const expressions: Record<string, number> = {};
    const head = new Object3D();
    const vrm = {
      humanoid: { getNormalizedBoneNode: (name: string) => (name === 'head' ? head : null) },
      expressionManager: {
        setValue: (name: string, val: number) => {
          expressions[name] = val;
        },
      },
      update: () => {},
    } as unknown as VRM;

    const tick = animator(vrm);
    for (let i = 0; i < 15; i++) tick(0.05, 0.75, 'speaking', undefined, true);

    expect(expressions['aa']).toBe(0.75);
    expect(expressions['oh']).toBeCloseTo(0.15, 2);
    expect(expressions['happy']).toBeGreaterThan(0.2);
    expect(head.rotation.x).not.toBe(0);
  });
  it('calculates dynamic portrait framing based on head and torso span', () => {
    const head = new Object3D(); head.position.y = 2.0;
    const hips = new Object3D(); hips.position.y = 1.0;
    const scene = new Object3D();
    scene.add(head);
    scene.add(hips);
    const vrm = {
      scene,
      humanoid: {
        getNormalizedBoneNode: (name: string) => (name === 'head' ? head : name === 'hips' ? hips : null),
      },
    } as unknown as VRM;

    const { target, distance } = portraitFraming(vrm);
    expect(target.y).toBeLessThan(2.0);
    expect(target.y).toBeGreaterThan(1.4);
    expect(distance).toBeGreaterThan(2.0);
  });
});
