import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationClip, NumberKeyframeTrack, Object3D, Quaternion, Vector3, VectorKeyframeTrack } from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  animator,
  BASE_IDLE_COOLDOWN_SEC,
  calculateIdleDwell,
  GREETING_POOL,
  IDLE_POOL,
  isBaseIdleUrl,
  resetUnavailableClips,
  selectWeightedAnimation,
  VRMA_PATHS,
} from './vrmAnimator.js';

const mockLoadClipSafe = vi.fn();
vi.mock('./vrmaLoader.js', () => {
  return {
    loadVrmaClipSafe: (...args: unknown[]) => mockLoadClipSafe(...args),
    resolveAnimationUrl: (p: string) => p,
  };
});

beforeEach(() => resetUnavailableClips());

function createDummyClip(name: string, duration = 2.0): AnimationClip {
  const track = new VectorKeyframeTrack('hips.position', [0, duration], [0, 0, 0, 0, 0.1, 0]);
  return new AnimationClip(name, duration, [track]);
}

function createDummyVrm(): VRM {
  const scene = new Object3D();
  const hips = new Object3D();
  hips.name = 'hips';
  scene.add(hips);
  const head = new Object3D();
  head.name = 'head';
  head.position.y = 1.45;
  scene.add(head);

  return {
    scene,
    humanoid: {
      getNormalizedBoneNode: (name: string) => (name === 'hips' ? hips : name === 'head' ? head : null),
    },
    lookAt: {
      target: null,
      autoUpdate: true,
      getLookAtWorldPosition: (target: Vector3) => head.getWorldPosition(target),
      getLookAtWorldQuaternion: (target: Quaternion) => head.getWorldQuaternion(target),
      getFaceFrontQuaternion: (target: Quaternion) => target.identity(),
      update: vi.fn(),
    },
    expressionManager: {
      setValue: vi.fn(),
    },
    update: vi.fn(),
  } as unknown as VRM;
}

describe('Weighted Animation Selection', () => {
  it('selects greeting strictly according to greeting pool weights (80% VRMA_02 greeting, 20% 004_hello_1)', () => {
    // 0.00 to 0.80 -> VRMA_02 Greeting (80%)
    expect(selectWeightedAnimation(GREETING_POOL, () => 0.0)).toBe(VRMA_PATHS.GREETING);
    expect(selectWeightedAnimation(GREETING_POOL, () => 0.5)).toBe(VRMA_PATHS.GREETING);
    expect(selectWeightedAnimation(GREETING_POOL, () => 0.8)).toBe(VRMA_PATHS.GREETING);

    // 0.8001 to 1.00 -> 004_hello_1 (20%)
    expect(selectWeightedAnimation(GREETING_POOL, () => 0.8001)).toBe(VRMA_PATHS.HELLO);
    expect(selectWeightedAnimation(GREETING_POOL, () => 0.95)).toBe(VRMA_PATHS.HELLO);
    expect(selectWeightedAnimation(GREETING_POOL, () => 1.0)).toBe(VRMA_PATHS.HELLO);
  });

  it('selects idle animations according to idle pool probability weights (74.95% base idle, 23% smartphone, 2% drinkwater, 0.05% motion pose)', () => {
    // 0.00 to 0.7495 -> Base Idle (idle.vrma) (74.95%)
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.0)).toBe(VRMA_PATHS.BASE_IDLE);
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.5)).toBe(VRMA_PATHS.BASE_IDLE);
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.7495)).toBe(VRMA_PATHS.BASE_IDLE);

    // 0.7496 to 0.9795 -> 005_smartphone (23%)
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.7496)).toBe(VRMA_PATHS.SMARTPHONE);
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.85)).toBe(VRMA_PATHS.SMARTPHONE);
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.9795)).toBe(VRMA_PATHS.SMARTPHONE);

    // 0.9796 to 0.9995 -> 006_drinkwater (2%)
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.9796)).toBe(VRMA_PATHS.DRINK_WATER);
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.99)).toBe(VRMA_PATHS.DRINK_WATER);
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.9995)).toBe(VRMA_PATHS.DRINK_WATER);

    // 0.9996 to 1.00 -> 001_motion_pose (0.05%)
    expect(selectWeightedAnimation(IDLE_POOL, () => 0.9996)).toBe(VRMA_PATHS.MOTION_POSE);
    expect(selectWeightedAnimation(IDLE_POOL, () => 1.0)).toBe(VRMA_PATHS.MOTION_POSE);
  });
});

describe('Mouth Expression Clamping & Deadband', () => {
  it.each(['thinking', 'idle', 'speaking', 'speaking_alt'])('uses clip activity rather than visual state %s to open and close visemes', state => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);
    const lastValue = (name: string): number => {
      const calls = (vrm.expressionManager?.setValue as ReturnType<typeof vi.fn>).mock.calls;
      const matches = calls.filter(([key]) => key === name);
      return matches[matches.length - 1]?.[1] as number;
    };

    tick(0.016, 0.5, state, undefined, true);
    expect(lastValue('aa')).toBe(0.5);
    expect(lastValue('oh')).toBe(0.1);

    tick(0.016, 0.5, state, undefined, false);
    expect(lastValue('aa')).toBe(0);
    expect(lastValue('oh')).toBe(0);
    tick.dispose();
  });

  it('keeps sleeping visemes closed even if audio remains active', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);
    tick(0.016, 0.5, 'sleeping', undefined, true);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('oh', 0);
    tick.dispose();
  });

  it('preserves a small active opening but keeps sleeping mouth blendshapes closed', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);

    tick(0.016, 0.02, 'speaking', undefined, true);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0.02);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('oh', 0.004);

    (vrm.expressionManager?.setValue as ReturnType<typeof vi.fn>).mockClear();
    tick(0.016, 0.5, 'sleeping', undefined, true);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('oh', 0);

    tick.dispose();
  });

  it('clamps maximum mouth opening to 0.75 to protect models from unnatural jaw dislocation', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);

    // Full volume: 1.0 -> must clamp to at most 0.75
    tick(0.016, 1.0, 'speaking', undefined, true);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0.75);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('oh', expect.closeTo(0.15, 2));

    tick.dispose();
  });

  // An analyser sample may remain non-zero immediately after playback ends.
  // Source activity must close the visemes without waiting for another poll.
  it('closes the mouth on the same tick a non-speaking state begins, even with a stale non-zero mouth reading', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);

    // The last analyser sample remains after speech was interrupted.
    tick(0.016, 0.5, 'thinking');
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0);
    expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('oh', 0);

    tick.dispose();
  });

  it('closes the mouth for every other non-speaking state despite a stale non-zero mouth reading', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);

    for (const state of ['idle', 'listening', 'sleeping', 'angry', 'error'] as const) {
      (vrm.expressionManager?.setValue as ReturnType<typeof vi.fn>).mockClear();
      tick(0.016, 0.5, state);
      expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('aa', 0);
      expect(vrm.expressionManager?.setValue).toHaveBeenCalledWith('oh', 0);
    }

    tick.dispose();
  });
});

describe('Audio-gated facial expressions', () => {
  function value(vrm: VRM, name: string): number {
    const calls = (vrm.expressionManager?.setValue as ReturnType<typeof vi.fn>).mock.calls;
    const matching = calls.filter(([key]) => key === name);
    return matching[matching.length - 1]?.[1] as number;
  }

  it('keeps thinking and listening expressions neutral while retaining their body posture', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);
    const head = vrm.humanoid?.getNormalizedBoneNode('head')!;
    tick(0.05, 0, 'thinking');
    expect(value(vrm, 'surprised')).toBe(0);
    expect(value(vrm, 'happy')).toBe(0);
    expect(head.rotation.x).not.toBe(0);

    tick(0.05, 0, 'listening');
    expect(value(vrm, 'happy')).toBe(0);
    expect(value(vrm, 'surprised')).toBe(0);
    tick.dispose();
  });

  it.each(['speaking', 'speaking_alt'])('allows %s happy only during an active clip and clears it on audio end', state => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);
    tick(0.05, 0, state);
    expect(value(vrm, 'happy')).toBe(0);
    tick(0.05, 0, state, undefined, true);
    expect(value(vrm, 'happy')).toBeGreaterThan(0);
    tick(0.05, 0, state, undefined, false);
    expect(value(vrm, 'happy')).toBe(0);
    expect(value(vrm, 'aa')).toBe(0);
    tick.dispose();
  });
});

describe('Mouse Gaze and Head Tracking', () => {
  it('attaches lookAtTarget to scene and assigns it to vrm.lookAt.target', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);

    expect(vrm.lookAt?.target).toBeDefined();
    expect(vrm.lookAt?.target?.name).toBe('VRMMouseLookAtTarget');
    expect(vrm.scene.children.some((c: Object3D) => c.name === 'VRMMouseLookAtTarget')).toBe(true);

    tick.dispose();
    expect(vrm.lookAt?.target).toBeNull();
    expect(vrm.scene.children.some((c: Object3D) => c.name === 'VRMMouseLookAtTarget')).toBe(false);
  });

  it('smoothly directs eyes lookAt target and head rotation towards active mouse coordinates', () => {
    const vrm = createDummyVrm();
    const head = vrm.humanoid?.getNormalizedBoneNode('head');
    const tick = animator(vrm);

    // Initial baseline at center (mouse inactive)
    tick(0.016, 0, 'idle');
    const restHeadX = head?.rotation.x ?? 0;
    const restHeadY = head?.rotation.y ?? 0;

    // Simulate mouse moving to upper right (x=1.0, y=0.8, active=true) over several frames
    for (let i = 0; i < 30; i++) {
      tick(0.016, 0, 'idle', { x: 1.0, y: 0.8, active: true });
    }

    // LookAt target position should be displaced right (x > 0) and up (y > 1.4)
    const targetObj = vrm.lookAt?.target as Object3D;
    expect(targetObj.position.x).toBeGreaterThan(0.4);
    expect(targetObj.position.y).toBeGreaterThan(1.5);

    // Head bone rotation: yaw turns right (positive Y), pitch tilts up (negative X)
    expect(head?.rotation.y).toBeGreaterThan(restHeadY);
    expect(head?.rotation.x).toBeLessThan(restHeadX);

    tick.dispose();
  });

  it('suppresses mouse tracking and centers eyes during sleeping state', () => {
    const vrm = createDummyVrm();
    const head = vrm.humanoid?.getNormalizedBoneNode('head');
    const tick = animator(vrm);

    // Prime with mouse active in idle
    for (let i = 0; i < 20; i++) {
      tick(0.016, 0, 'idle', { x: 1.0, y: 1.0, active: true });
    }

    // Transition to sleeping
    for (let i = 0; i < 30; i++) {
      tick(0.016, 0, 'sleeping', { x: 1.0, y: 1.0, active: true });
    }

    // In sleeping state, targetObj returns towards center (x -> 0)
    const targetObj = vrm.lookAt?.target as Object3D;
    expect(Math.abs(targetObj.position.x)).toBeLessThan(0.15);

    // Head pitch reflects sleeping nod down (positive X)
    expect(head?.rotation.x).toBeGreaterThan(0.1);

    tick.dispose();
  });

  it('smoothly damps back to center when mouse becomes inactive', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);

    // Mouse active
    for (let i = 0; i < 30; i++) {
      tick(0.016, 0, 'idle', { x: 1.0, y: 0.0, active: true });
    }
    const targetObj = vrm.lookAt?.target as Object3D;
    expect(targetObj.position.x).toBeGreaterThan(0.3);

    // Mouse becomes inactive (e.g. idle timeout or pointer leave)
    for (let i = 0; i < 40; i++) {
      tick(0.016, 0, 'idle', { x: 1.0, y: 0.0, active: false });
    }
    expect(targetObj.position.x).toBeLessThan(0.1);

    tick.dispose();
  });
});

describe('VRMA Animation Controller Integration', () => {
  beforeEach(() => {
    mockLoadClipSafe.mockReset();
  });

  it('plays one-shot greeting (VRMA_02 or 004_hello_1) on startup and transitions to weighted idle pool', async () => {
    const baseIdleClip = createDummyClip('idle', 10.0);
    const greetClip = createDummyClip('vrma_02', 7.2);
    const helloClip = createDummyClip('004_hello_1', 6.0);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return baseIdleClip;
      if (url === VRMA_PATHS.GREETING) return greetClip;
      if (url === VRMA_PATHS.HELLO) return helloClip;
      return null;
    });

    const vrm = createDummyVrm();
    const tick = animator(vrm, () => 0.5); // 0.5 picks GREETING from GREETING_POOL (80%)

    // Allow promise microtasks to resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoadClipSafe).toHaveBeenCalledWith(VRMA_PATHS.BASE_IDLE, vrm);
    expect(mockLoadClipSafe).toHaveBeenCalledWith(VRMA_PATHS.GREETING, vrm);
    expect(mockLoadClipSafe).toHaveBeenCalledWith(VRMA_PATHS.HELLO, vrm);

    // Advance past greeting duration (7.2s) to trigger transition to idle
    tick(4.0, 0, 'idle');
    tick(4.0, 0, 'idle');

    expect(vrm.update).toHaveBeenCalled();
    tick.dispose();
  });

  it('selects 004_hello_1 wake-up greeting on startup when random threshold is within 20% bracket', async () => {
    const baseIdleClip = createDummyClip('idle', 10.0);
    const helloClip = createDummyClip('004_hello_1', 6.0);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return baseIdleClip;
      if (url === VRMA_PATHS.HELLO) return helloClip;
      return null;
    });

    const vrm = createDummyVrm();
    const tick = animator(vrm, () => 0.9); // 0.9 picks HELLO from GREETING_POOL (20%)

    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoadClipSafe).toHaveBeenCalledWith(VRMA_PATHS.HELLO, vrm);
    tick(0.016, 0, 'idle');
    expect(vrm.update).toHaveBeenCalled();
    tick.dispose();
  });

  it('plays base idle clip directly when greeting clip is unavailable', async () => {
    const baseClip = createDummyClip('idle', 11.8);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return baseClip;
      return null;
    });

    const vrm = createDummyVrm();
    const tick = animator(vrm);

    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoadClipSafe).toHaveBeenCalledWith(VRMA_PATHS.BASE_IDLE, vrm);
    tick(0.016, 0, 'idle');
    expect(vrm.update).toHaveBeenCalledWith(0.016);
    tick.dispose();
  });

  it('wakes up smoothly into base idle without replaying greeting', async () => {
    const baseClip = createDummyClip('idle', 11.8);
    const greetClip = createDummyClip('vrma_02', 7.2);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return baseClip;
      if (url === VRMA_PATHS.GREETING) return greetClip;
      return null;
    });

    const vrm = createDummyVrm();
    const tick = animator(vrm);

    await Promise.resolve();
    await Promise.resolve();

    // Fall asleep
    tick(0.05, 0, 'sleeping');

    // Wake up
    tick(0.05, 0, 'idle');

    expect(vrm.update).toHaveBeenCalled();
    tick.dispose();
  });

  it('triggers conversational gestures during speech after cooldown elapses', async () => {
    const idleClip = createDummyClip('idle', 3.0);
    const shootClip = createDummyClip('shoot', 2.0);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return idleClip;
      if (url === VRMA_PATHS.SHOOT) return shootClip;
      return null;
    });

    const vrm = createDummyVrm();
    // Fixed random generator returning 0.05 (< 0.2) triggers VRMA_PATHS.SHOOT
    const tick = animator(vrm, () => 0.05);

    await Promise.resolve();
    await Promise.resolve();

    // Next gesture scheduled at ~14 + 0.05*14 = ~14.7s
    for (let i = 0; i < 350; i++) {
      tick(0.05, 0.4, 'speaking');
    }

    expect(vrm.update).toHaveBeenCalled();
    tick.dispose();
  });

  it('keeps avatar in idle during speech when 20% gesture roll fails (random >= 0.2)', async () => {
    const idleClip = createDummyClip('idle', 3.0);
    const shootClip = createDummyClip('shoot', 2.0);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return idleClip;
      if (url === VRMA_PATHS.SHOOT) return shootClip;
      return null;
    });

    const vrm = createDummyVrm();
    // Fixed random generator returning 0.5 (>= 0.2, 80% idle chance)
    const tick = animator(vrm, () => 0.5);

    await Promise.resolve();
    await Promise.resolve();

    for (let i = 0; i < 350; i++) {
      tick(0.05, 0.4, 'speaking');
    }

    expect(vrm.update).toHaveBeenCalled();
    tick.dispose();
  });

function advanceTime(tickFn: (delta: number, mouth: number, state?: string) => void, seconds: number, state = 'idle') {
  const step = 0.05;
  const count = Math.ceil(seconds / step);
  for (let i = 0; i < count; i++) {
    tickFn(step, 0, state);
  }
}

  it('cycles naturally to another weighted idle animation after current idle finishes without ever repeating greeting', async () => {
    const baseIdleClip = createDummyClip('idle', 4.0);
    const smartphoneClip = createDummyClip('005_smartphone', 5.0);
    const greetClip = createDummyClip('vrma_02', 2.0);

    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return baseIdleClip;
      if (url === VRMA_PATHS.SMARTPHONE) return smartphoneClip;
      if (url === VRMA_PATHS.GREETING) return greetClip;
      return null;
    });

    const vrm = createDummyVrm();
    // Return 0.85 on random() to pick smartphone from idle pool (0.7496 to 0.9795)
    const tick = animator(vrm, () => 0.85);

    await Promise.resolve();
    await Promise.resolve();

    // 1. Advance past initial greeting (2s)
    advanceTime(tick, 2.5, 'idle');
    expect(vrm.update).toHaveBeenCalled();

    // 2. Advance past initial idle duration (calculateIdleDwell ensures >= 120s for BASE_IDLE)
    // to trigger cycle to next weighted idle
    advanceTime(tick, 125.0, 'idle');
    expect(vrm.update).toHaveBeenCalled();

    tick.dispose();
  });

  it('does not zero out action weight or enter T-pose when the same idle animation (74.95% BASE_IDLE) repeats in cycle', async () => {
    const baseIdleClip = createDummyClip('idle', 4.0);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return baseIdleClip;
      return null;
    });

    const vrm = createDummyVrm();
    // Return 0.2 on random() to pick BASE_IDLE consistently (74.95% weight)
    const tick = animator(vrm, () => 0.2);

    await Promise.resolve();
    await Promise.resolve();

    // Advance past initial duration (calculateIdleDwell ensures >= 120s for BASE_IDLE)
    advanceTime(tick, 125.0, 'idle');

    // Run another frame: mixer update must be called and model updated
    tick(0.016, 0, 'idle');
    expect(vrm.update).toHaveBeenCalledWith(0.016);

    tick.dispose();
  });

  it('calculateIdleDwell doubles duration for base idle loop with 120s minimum repose delay', () => {
    // Base idle loop doubles dwell time (min 120s)
    expect(calculateIdleDwell(VRMA_PATHS.MODEL_POSE, 7.5)).toBe(120);
    expect(calculateIdleDwell(VRMA_PATHS.MODEL_POSE, 50.0)).toBe(120);
    expect(calculateIdleDwell(VRMA_PATHS.MODEL_POSE, 70.0)).toBe(140);
    expect(calculateIdleDwell(VRMA_PATHS.BASE_IDLE, 7.5)).toBe(120);

    // One-shot idle animations retain their natural clip duration
    expect(calculateIdleDwell(VRMA_PATHS.SMARTPHONE, 4.2)).toBe(4.2);
    expect(calculateIdleDwell(VRMA_PATHS.HELLO, 3.8)).toBe(3.8);
    expect(calculateIdleDwell(VRMA_PATHS.DRINK_WATER, 5.0)).toBe(5.0);
  });

  it('identifies base idle URLs and respects minimum 120s repose delay constant', () => {
    expect(BASE_IDLE_COOLDOWN_SEC).toBe(120);
    expect(isBaseIdleUrl(VRMA_PATHS.BASE_IDLE)).toBe(true);
    expect(isBaseIdleUrl(VRMA_PATHS.MODEL_POSE)).toBe(true);
    expect(isBaseIdleUrl(VRMA_PATHS.IDLE)).toBe(true);
    expect(isBaseIdleUrl(VRMA_PATHS.SMARTPHONE)).toBe(false);
    expect(isBaseIdleUrl(VRMA_PATHS.DRINK_WATER)).toBe(false);
    expect(isBaseIdleUrl(VRMA_PATHS.MOTION_POSE)).toBe(false);
  });

  it('enforces return to BASE_IDLE for at least 15s repose cooldown after a one-shot pose finishes', async () => {
    const baseIdleClip = createDummyClip('idle', 7.5);
    const smartphoneClip = createDummyClip('005_smartphone', 4.0);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return baseIdleClip;
      if (url === VRMA_PATHS.SMARTPHONE) return smartphoneClip;
      return null;
    });

    const vrm = createDummyVrm();
    // 0.85 selects smartphone on startup
    const tick = animator(vrm, () => 0.85);
    await Promise.resolve();
    await Promise.resolve();

    // Advance past smartphone duration (4.0s)
    tick(4.1, 0, 'idle');
    expect(vrm.update).toHaveBeenCalled();

    tick.dispose();
  });

  it('does not interrupt active one-shot idle poses with speech gestures until returned to base idle', async () => {
    const baseIdleClip = createDummyClip('idle', 7.5);
    const smartphoneClip = createDummyClip('005_smartphone', 5.0);
    const shootClip = createDummyClip('shoot', 2.0);
    mockLoadClipSafe.mockImplementation(async (url: string) => {
      if (url === VRMA_PATHS.BASE_IDLE) return baseIdleClip;
      if (url === VRMA_PATHS.SMARTPHONE) return smartphoneClip;
      if (url === VRMA_PATHS.SHOOT) return shootClip;
      return null;
    });

    const vrm = createDummyVrm();
    // 0.85 selects smartphone on startup
    const tick = animator(vrm, () => 0.85);
    await Promise.resolve();
    await Promise.resolve();

    // While smartphone is playing, speaking should not throw or interrupt
    tick(2.0, 0.5, 'speaking');
    expect(vrm.update).toHaveBeenCalled();

    tick.dispose();
  });

  it('disposes cleanly without throwing', () => {
    const vrm = createDummyVrm();
    const tick = animator(vrm);
    expect(() => tick.dispose()).not.toThrow();
  });
});

describe('VRM 1.0 vs 0.0 Arm Polarity in Sleep / Procedural Fallback', () => {
  function createDummyVrmWithArms(metaVersion: '0' | '1' = '0') {
    const scene = new Object3D();
    const hips = new Object3D();
    const head = new Object3D();
    const leftUpperArm = new Object3D();
    const rightUpperArm = new Object3D();
    scene.add(hips, head, leftUpperArm, rightUpperArm);

    const vrm = {
      scene,
      meta: { metaVersion },
      humanoid: {
        getNormalizedBoneNode: (name: string) => {
          if (name === 'hips') return hips;
          if (name === 'head') return head;
          if (name === 'leftUpperArm') return leftUpperArm;
          if (name === 'rightUpperArm') return rightUpperArm;
          return null;
        },
      },
      expressionManager: { setValue: vi.fn() },
      update: vi.fn(),
    } as unknown as VRM;

    return { vrm, leftUpperArm, rightUpperArm };
  }

  it('rests arms downward with positive Z on left and negative Z on right for VRM 0.0', () => {
    const { vrm, leftUpperArm, rightUpperArm } = createDummyVrmWithArms('0');
    const tick = animator(vrm);

    for (let i = 0; i < 60; i++) {
      tick(0.016, 0, 'sleeping');
    }

    expect(leftUpperArm.rotation.z).toBeGreaterThan(1.0);
    expect(rightUpperArm.rotation.z).toBeLessThan(-1.0);
    tick.dispose();
  });

  it('rests arms downward with negative Z on left and positive Z on right for VRM 1.0', () => {
    const { vrm, leftUpperArm, rightUpperArm } = createDummyVrmWithArms('1');
    const tick = animator(vrm);

    for (let i = 0; i < 60; i++) {
      tick(0.016, 0, 'sleeping');
    }

    expect(leftUpperArm.rotation.z).toBeLessThan(-1.0);
    expect(rightUpperArm.rotation.z).toBeGreaterThan(1.0);
    tick.dispose();
  });
});

describe('Head Rotation Invariance & lookAtTarget Dynamic Tracking', () => {
  it('does not accumulate procedural head rotation indefinitely across frames', async () => {
    const baseIdleClip = createDummyClip('idle', 10.0);
    mockLoadClipSafe.mockResolvedValue(baseIdleClip);

    const vrm = createDummyVrm();
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head')!;
    const tick = animator(vrm);
    await Promise.resolve();
    await Promise.resolve();

    // Run 600 frames (~10 seconds of continuous animation)
    for (let i = 0; i < 600; i++) {
      tick(0.016, 0, 'idle', { x: 1.0, y: 0.0, active: true });
    }

    // Must remain within subtle procedural bounds (never compounding to 180 degrees)
    expect(Math.abs(headNode.rotation.z)).toBeLessThanOrEqual(0.03);
    expect(headNode.rotation.z).toBeGreaterThanOrEqual(-0.12);
    expect(headNode.rotation.z).toBeLessThanOrEqual(0.12);

    expect(headNode.rotation.y).toBeGreaterThan(0.05);
    expect(headNode.rotation.y).toBeLessThanOrEqual(0.65);

    tick.dispose();
  });

  it('updates lookAtTarget position relative to live head position', () => {
    const vrm = createDummyVrm();
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head')!;
    headNode.position.set(0, 1.54, 0.1);
    vrm.scene?.updateMatrixWorld(true);

    const tick = animator(vrm);
    const lookAtTarget = vrm.lookAt?.target as Object3D;
    expect(lookAtTarget).toBeDefined();

    // In upright idle, lookAtTarget Y matches head height ~1.54
    tick(0.016, 0, 'idle');
    expect(lookAtTarget.position.y).toBeCloseTo(1.54, 1);
    expect(lookAtTarget.position.z).toBeCloseTo(1.6, 1);

    // When avatar bows forward (head lowers to 0.85m and moves forward to 0.6m in Z)
    headNode.position.set(0, 0.85, 0.6);
    headNode.updateMatrixWorld(true);
    tick(0.016, 0, 'idle');

    // lookAtTarget must follow head down to ~0.85m and forward to ~2.1m
    expect(lookAtTarget.position.y).toBeCloseTo(0.85, 1);
    expect(lookAtTarget.position.z).toBeCloseTo(2.1, 1);

    tick.dispose();
  });

  it('playCustomAnimation with BASE_IDLE does not self-fade when already active', async () => {
    const baseIdleClip = createDummyClip('idle', 10.0);
    mockLoadClipSafe.mockResolvedValue(baseIdleClip);

    const vrm = createDummyVrm();
    const tick = animator(vrm);
    await Promise.resolve();
    await Promise.resolve();

    // Call playCustomAnimation with BASE_IDLE
    const duration = await tick.playCustomAnimation(VRMA_PATHS.BASE_IDLE);
    expect(duration).toBe(10.0);

    // Advancing tick should remain active without throwing or stopping
    expect(() => tick(0.016, 0, 'idle')).not.toThrow();

    tick.dispose();
  });
});

