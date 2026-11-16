import type { VRM } from '@pixiv/three-vrm';
import {
  AnimationClip,
  AnimationMixer,
  LoopRepeat,
  LoopOnce,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type AnimationAction,
} from 'three';
import { loadVrmaClipSafe } from './vrmaLoader.js';
import type { VrmDiagnosticSurface, VrmMouthGate } from './vrmDiagnostics.js';

export function clampDelta(dt: number) { return Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0; }
export function rms(samples: Float32Array) {
  if (!samples.length) return 0;
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}
function damp(current: number, target: number, dt: number, lambda = 6): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export interface WeightedAnimation {
  url: string;
  weight: number;
}

export const VRMA_PATHS = {
  GREETING: '/animations/VRMA_02.vrma',
  BASE_IDLE: '/animations/idle.vrma',
  IDLE: '/animations/idle.vrma',
  MODEL_POSE: '/animations/idle.vrma', // Alias pointing to base idle
  VRMA_06: '/animations/VRMA_06.vrma',
  SMARTPHONE: '/animations/005_smartphone.vrma',
  HELLO: '/animations/004_hello_1.vrma',
  DRINK_WATER: '/animations/006_drinkwater.vrma',
  MOTION_POSE: '/animations/001_motion_pose.vrma',
  PEACE: '/animations/VRMA_03.vrma',
  SHOOT: '/animations/VRMA_04.vrma',
};

/**
 * VRMA_01..07 (pixiv VRoid pack) are never distributed: the owner keeps them
 * locally, git-ignored. When one is absent the logical motion plays this CC0
 * (001..008) clip instead. Present files are still preferred.
 */
export const CLIP_FALLBACKS: Record<string, string> = {
  [VRMA_PATHS.GREETING]: VRMA_PATHS.HELLO,
  [VRMA_PATHS.VRMA_06]: VRMA_PATHS.MOTION_POSE,
  [VRMA_PATHS.PEACE]: '/animations/007_gekirei.vrma',
  [VRMA_PATHS.SHOOT]: '/animations/007_gekirei.vrma',
};

/** URLs already known to be missing/unloadable: never requested twice. */
const unavailableClips = new Set<string>();
export function resetUnavailableClips(): void {
  unavailableClips.clear();
}

/** Next CC0 URL to try after `url` failed; marks `url` as unavailable. */
function nextFallback(url: string): string | null {
  unavailableClips.add(url);
  const fallback = CLIP_FALLBACKS[url];
  return fallback && fallback !== url && !unavailableClips.has(fallback) ? fallback : null;
}

export const GREETING_POOL: WeightedAnimation[] = [
  { url: VRMA_PATHS.GREETING, weight: 0.8 },
  { url: VRMA_PATHS.HELLO, weight: 0.2 },
];

export const IDLE_POOL: WeightedAnimation[] = [
  { url: VRMA_PATHS.BASE_IDLE, weight: 0.7495 },
  { url: VRMA_PATHS.SMARTPHONE, weight: 0.23 },
  { url: VRMA_PATHS.DRINK_WATER, weight: 0.02 },
  { url: VRMA_PATHS.MOTION_POSE, weight: 0.0005 },
];

export const BASE_IDLE_COOLDOWN_SEC = 120;

export function isBaseIdleUrl(url: string): boolean {
  return url === VRMA_PATHS.BASE_IDLE || url === VRMA_PATHS.MODEL_POSE || url === VRMA_PATHS.IDLE;
}

export function calculateIdleDwell(url: string, duration: number): number {
  // BASE_IDLE (idle.vrma) is the base idle loop.
  // Enforce a minimum 120s (2 min) repose dwell to ensure calm, composed breathing
  // and prevent hyperactive switching between poses.
  if (isBaseIdleUrl(url)) {
    return Math.max(duration * 2, BASE_IDLE_COOLDOWN_SEC);
  }
  return duration;
}

export function selectWeightedAnimation(pool: WeightedAnimation[], random = Math.random): string {
  if (!pool.length) return '';
  const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
  const threshold = random() * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < pool.length; i++) {
    cumulative += pool[i].weight;
    if (threshold <= cumulative + 1e-9 || i === pool.length - 1) {
      return pool[i].url;
    }
  }
  return pool[pool.length - 1].url;
}

export interface LookAtTarget {
  x: number;
  y: number;
  active?: boolean;
}

export interface VrmAnimatorInstance {
  (delta: number, mouth: number, state?: string, mouse?: LookAtTarget, audioActive?: boolean, observeLipSyncFrame?: LipSyncFrameObserver, frameId?: number, surface?: VrmDiagnosticSurface): void;
  isGreeting: () => boolean;
  /** `hold`: clamp on the last frame and never auto-finish; the caller ends it with `null`. */
  playCustomAnimation: (url: string | null, onFinished?: () => void, options?: { hold?: boolean }) => Promise<number>;
  dispose: () => void;
}

export type LipSyncFrameObserver = (
  surface: VrmDiagnosticSurface, frameId: number, inputMouth: number, audioActive: boolean, state: string,
  activeMouth: number, mouthOpen: number, aa: number, oh: number, gateReason: VrmMouthGate,
) => void;

export function animator(vrm: VRM, random = Math.random): VrmAnimatorInstance {
  let elapsed = 0;
  let nextBlink = 3 + random() * 3;
  let blinkVal = 0;

  let curHappy = 0;
  let curRelaxed = 0.25;
  let curAngry = 0;
  let curSad = 0;
  let curSurprised = 0;

  let curHeadPitch = 0;
  let curHeadYaw = 0;
  let curHeadRoll = 0;

  // Mouse gaze & head tracking state
  let curMouseNormX = 0;
  let curMouseNormY = 0;
  let curMouseYaw = 0;
  let curMousePitch = 0;

  const lookAtTarget = new Object3D();
  lookAtTarget.name = 'VRMMouseLookAtTarget';
  const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
  vrm.scene?.updateMatrixWorld(true);
  const initialHeadPos = new Vector3();
  headNode?.getWorldPosition(initialHeadPos);
  const defaultEyeY = initialHeadPos.y > 0.5 ? initialHeadPos.y : 1.45;
  lookAtTarget.position.set(0, defaultEyeY, 1.5);
  vrm.scene?.add(lookAtTarget);
  if (vrm.lookAt) {
    vrm.lookAt.target = lookAtTarget;
    vrm.lookAt.autoUpdate = true;
  }

  const tempHeadPos = new Vector3();
  const tempHeadQuat = new Quaternion();
  const tempFaceQuat = new Quaternion();
  const tempForward = new Vector3();
  let customRequest = 0;

  let prevAddPitch = 0;
  let prevAddYaw = 0;
  let prevAddRoll = 0;

  let customAnimResolver: (() => void) | null = null;
  let customAnimTimeout: ReturnType<typeof setTimeout> | undefined;

  const cancelCustomWaiter = () => {
    if (customAnimTimeout) {
      clearTimeout(customAnimTimeout);
      customAnimTimeout = undefined;
    }
    customAnimResolver = null;
  };

  const completeCustomWaiter = () => {
    const callback = customAnimResolver;
    cancelCustomWaiter();
    callback?.();
  };

  // VRMA Skeletal Animation Mixer
  const mixerRoot = vrm.scene ?? vrm.humanoid?.getNormalizedBoneNode('hips')?.parent ?? new Object3D();
  const mixer = new AnimationMixer(mixerRoot);
  let activeIdleAction: AnimationAction | null = null;
  let activeIdleUrl = '';
  let activeIdleStart = 0;
  let activeIdleDuration = 0;

  let activeGestureAction: AnimationAction | null = null;
  let activeGestureDuration = 0;
  let holdGesture = false;
  let isGreetingActive = false;
  let hasVrma = false;
  let disposed = false;
  let isSleeping = false;
  let wasSleeping = false;
  let speedJitterTimer = 0;
  let nextGestureTime = 14 + random() * 14;

  const clips = new Map<string, AnimationClip>();
  const speechGestureCandidates = [VRMA_PATHS.SHOOT];
  const allPreloadUrls = [
    ...GREETING_POOL.map(g => g.url),
    ...IDLE_POOL.map(i => i.url),
    ...speechGestureCandidates,
  ];

  const finishGesture = () => {
    isGreetingActive = false;
    if (!activeGestureAction) return;
    activeGestureAction.fadeOut(0.6);
    if (activeIdleAction && !isSleeping) {
      activeIdleAction.reset().setEffectiveWeight(1).fadeIn(0.6).play();
      activeIdleStart = elapsed;
    }
    activeGestureAction = null;
  };

  const finishOneShotIdle = () => {
    if (isBaseIdleUrl(activeIdleUrl)) return;
    const baseClip = clips.get(VRMA_PATHS.BASE_IDLE);
    if (baseClip) {
      const baseAction = mixer.clipAction(baseClip);
      baseAction.reset().setLoop(LoopRepeat, Infinity);
      baseAction.clampWhenFinished = false;
      baseAction.timeScale = 0.98 + random() * 0.04;
      baseAction.setEffectiveWeight(1).fadeIn(0.6).play();
      if (activeIdleAction && activeIdleAction !== baseAction) {
        activeIdleAction.fadeOut(0.6);
      }
      activeIdleAction = baseAction;
      activeIdleUrl = VRMA_PATHS.BASE_IDLE;
      activeIdleStart = elapsed;
      activeIdleDuration = calculateIdleDwell(VRMA_PATHS.BASE_IDLE, baseClip.duration);
    }
  };

  const onActionFinished = (event: unknown) => {
    if (disposed) return;
    const ev = event as { action?: AnimationAction };
    if (activeGestureAction && ev.action === activeGestureAction) {
      if (holdGesture) return;
      finishGesture();
      completeCustomWaiter();
    } else if (activeIdleAction && ev.action === activeIdleAction && !isBaseIdleUrl(activeIdleUrl)) {
      finishOneShotIdle();
    }
  };
  mixer.addEventListener('finished', onActionFinished as unknown as (event: import('three').Event) => void);

  // Async preload one-shot greeting, weighted idle pool, and speech gestures
  void (async () => {
    try {
      for (const url of allPreloadUrls) {
        if (unavailableClips.has(url) && !CLIP_FALLBACKS[url]) continue;
        let clip = unavailableClips.has(url) ? null : await loadVrmaClipSafe(url, vrm);
        if (disposed) return;
        if (!clip) {
          const fallback = nextFallback(url);
          if (fallback) {
            clip = await loadVrmaClipSafe(fallback, vrm);
            if (disposed) return;
            if (!clip) unavailableClips.add(fallback);
          }
        }
        if (clip) clips.set(url, clip);
      }

      // Late preload may supply the idle fallback, but never replace a QA request.

      // 1. Initial startup: select greeting once from GREETING_POOL (80% VRMA_02, 20% 004_hello_1)
      const initialGreetingUrl = selectWeightedAnimation(GREETING_POOL, random);
      const greetClip = clips.get(initialGreetingUrl) ?? clips.get(VRMA_PATHS.GREETING);
      if (greetClip && customRequest === 0) {
        const greetAction = mixer.clipAction(greetClip);
        greetAction.reset().setLoop(LoopOnce, 1);
        greetAction.clampWhenFinished = true;
        greetAction.setEffectiveWeight(1).fadeIn(0.2).play();
        activeGestureAction = greetAction;
        activeGestureDuration = Math.max(1.0, greetClip.duration);
        hasVrma = true;
        isGreetingActive = true;
      }

      // 2. Select initial idle animation from weighted pool (idle.vrma as base idle)
      const initialIdleUrl = customRequest > 0 ? VRMA_PATHS.BASE_IDLE : selectWeightedAnimation(IDLE_POOL, random);
      const initialIdleClip = clips.get(initialIdleUrl) ?? clips.get(VRMA_PATHS.BASE_IDLE);
      if (initialIdleClip && !activeIdleAction) {
        const idleAction = mixer.clipAction(initialIdleClip);
        const isLoop = isBaseIdleUrl(initialIdleUrl);
        if (isLoop) {
          idleAction.reset().setLoop(LoopRepeat, Infinity);
          idleAction.clampWhenFinished = false;
        } else {
          idleAction.reset().setLoop(LoopOnce, 1);
          idleAction.clampWhenFinished = true;
        }
        idleAction.timeScale = 1.0 + (random() * 0.03 - 0.015);
        if (activeGestureAction || isSleeping) {
          idleAction.setEffectiveWeight(0).play();
        } else {
          idleAction.setEffectiveWeight(1).fadeIn(0.2).play();
        }
        activeIdleAction = idleAction;
        activeIdleUrl = initialIdleUrl;
        activeIdleStart = 0;
        activeIdleDuration = calculateIdleDwell(initialIdleUrl, initialIdleClip.duration);
        hasVrma = true;
      }
    } catch {
      // Degrades gracefully to procedural animation on load failure
    }
  })();

  // Procedural bone references (used as immediate/offline fallback)
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest') ?? vrm.humanoid?.getNormalizedBoneNode('spine');
  const restChest = chest?.rotation.x ?? 0;

  const neck = vrm.humanoid?.getNormalizedBoneNode('neck');
  const restNeckX = neck?.rotation.x ?? 0;

  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  const restHeadX = head?.rotation.x ?? 0;
  const restHeadY = head?.rotation.y ?? 0;
  const restHeadZ = head?.rotation.z ?? 0;

  const leftUpperArm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const rightUpperArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  const leftLowerArm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
  const rightLowerArm = vrm.humanoid?.getNormalizedBoneNode('rightLowerArm');
  const leftHand = vrm.humanoid?.getNormalizedBoneNode('leftHand');
  const rightHand = vrm.humanoid?.getNormalizedBoneNode('rightHand');

  type GestureType = 'explain_right' | 'explain_left' | 'ponder' | 'rest_shift';
  let procNextGestureTime = 6 + random() * 8;
  let procGestureActive = false;
  let procGestureStartTime = 0;
  let procGestureDuration = 3.5;
  let currentProcGesture: GestureType = 'explain_right';

  const isVrm1 = vrm.meta?.metaVersion === '1';
  const armZSign = isVrm1 ? -1 : 1;

  let curLeftUpper = [0.08, 0, 1.25 * armZSign];
  let curRightUpper = [0.08, 0, -1.25 * armZSign];
  let curLeftLower = [0, 0.15, 0.1 * armZSign];
  let curRightLower = [0, -0.15, -0.1 * armZSign];
  let curLeftHand = [0.05, 0.1, 0.05 * armZSign];
  let curRightHand = [0.05, -0.1, -0.05 * armZSign];

  const tick = (
    delta: number, mouth: number, state = 'idle', mouse?: LookAtTarget, audioActive = false,
    observeLipSyncFrame?: LipSyncFrameObserver, frameId?: number, surface: VrmDiagnosticSurface = 'unknown',
  ) => {
    if (disposed) return;
    // Remove our prior contribution BEFORE the mixer writes fresh keyed values.
    if (head && head !== chest) {
      head.rotation.x -= prevAddPitch;
      head.rotation.y -= prevAddYaw;
      head.rotation.z -= prevAddRoll;
      prevAddPitch = prevAddYaw = prevAddRoll = 0;
    }
    const dt = clampDelta(delta);
    elapsed += dt;

    // 1. State Transitions for AnimationMixer (Sleep / Wake)
    isSleeping = state === 'sleeping';
    if (isSleeping !== wasSleeping) {
      wasSleeping = isSleeping;
      if (isSleeping) {
        ++customRequest;
        cancelCustomWaiter();
        activeIdleAction?.fadeOut(1.2);
        activeGestureAction?.fadeOut(0.8);
        activeGestureAction = null;
      } else {
        // Waking up: return smoothly to current idle pose without replaying greeting
        activeIdleAction?.reset().setEffectiveWeight(1).fadeIn(0.8).play();
        activeIdleStart = elapsed;
      }
    }

    // 2. Temporal speed variation (1-3% random jitter every 6-12 seconds)
    if (elapsed > speedJitterTimer) {
      speedJitterTimer = elapsed + 6 + random() * 6;
      if (activeIdleAction && !isSleeping) {
        activeIdleAction.timeScale = 0.98 + random() * 0.04;
      }
    }

    // 3. Conversational gestures during speech (VRMA_04 shoot with 20% probability)
    // Only permit speech gestures while in base idle loop to avoid interrupting active one-shot poses
    const isSpeaking = state === 'speaking' || state === 'speaking_alt';
    if (isSpeaking && !activeGestureAction && !isSleeping && elapsed >= nextGestureTime && isBaseIdleUrl(activeIdleUrl)) {
      if (random() < 0.2) {
        const ready = speechGestureCandidates.filter(url => clips.has(url));
        if (ready.length > 0 && activeIdleAction) {
          const chosen = ready[Math.floor(random() * ready.length)];
          const clip = clips.get(chosen)!;
          const gAction = mixer.clipAction(clip);
          gAction.reset().setLoop(LoopOnce, 1);
          gAction.clampWhenFinished = true;
          gAction.timeScale = 0.98 + random() * 0.04;
          gAction.setEffectiveWeight(0.6).fadeIn(0.6).play();
          activeIdleAction.fadeOut(0.6);
          activeGestureAction = gAction;
          activeGestureDuration = clip.duration;
          nextGestureTime = elapsed + activeGestureDuration + 14 + random() * 14;
        } else {
          nextGestureTime = elapsed + 14 + random() * 14;
        }
      } else {
        // 80% chance: remain in idle, schedule next gesture window
        nextGestureTime = elapsed + 14 + random() * 14;
      }
    }

    // 4. Return to idle after speech gesture (or startup greeting) completes
    // The mixer finished event owns natural completion (including timeScale).

    // 5. Advance weighted idle cycle when current idle animation finishes
    if (!activeGestureAction && activeIdleAction && !isSleeping && elapsed >= activeIdleStart + activeIdleDuration) {
      if (!isBaseIdleUrl(activeIdleUrl)) {
        // One-shot pose completed: ALWAYS return to base idle for a full repose period (>= 120s)
        finishOneShotIdle();
      } else if (state === 'idle') {
        // Base idle completed its full repose dwell (>= 120s) AND avatar is in idle state:
        // eligible to select next idle from pool
        const nextUrl = selectWeightedAnimation(IDLE_POOL, random);
        const nextClip = clips.get(nextUrl) ?? clips.get(VRMA_PATHS.BASE_IDLE);
        if (nextClip) {
          const nextAction = mixer.clipAction(nextClip);
          if (nextAction === activeIdleAction) {
            // Same base idle repeats: keep looping smoothly without hitch
            nextAction.setEffectiveWeight(1);
            if (!nextAction.isRunning()) nextAction.play();
            activeIdleStart = elapsed;
            activeIdleDuration = calculateIdleDwell(nextUrl, nextClip.duration);
          } else {
            // Different animation: crossfade smoothly
            const isLoop = isBaseIdleUrl(nextUrl);
            if (isLoop) {
              nextAction.reset().setLoop(LoopRepeat, Infinity);
              nextAction.clampWhenFinished = false;
            } else {
              nextAction.reset().setLoop(LoopOnce, 1);
              nextAction.clampWhenFinished = true;
            }
            nextAction.timeScale = 0.98 + random() * 0.04;
            nextAction.setEffectiveWeight(1).fadeIn(0.6).play();
            activeIdleAction.fadeOut(0.6);

            activeIdleAction = nextAction;
            activeIdleUrl = nextUrl;
            activeIdleStart = elapsed;
            activeIdleDuration = calculateIdleDwell(nextUrl, nextClip.duration);
          }
        }
      } else {
        // Active state (speaking, listening, etc.): keep looping base idle
        activeIdleStart = elapsed;
      }
    }

    // 6. Advance AnimationMixer
    mixer.update(dt);

    // 6. Procedural Fallback (runs when VRMA is not loaded or for sleep posture)
    if (!hasVrma || isSleeping) {
      const breathingFreq = isSleeping ? 1.1 : state === 'angry' ? 2.6 : 1.6;
      const breathingAmp = isSleeping ? 0.016 : state === 'angry' ? 0.018 : 0.012;

      if (chest) {
        chest.rotation.x = restChest + Math.sin(elapsed * breathingFreq) * breathingAmp;
      }

      const armSway = Math.sin(elapsed * breathingFreq) * 0.012;

      if (isSleeping) {
        procGestureActive = false;
        procNextGestureTime = elapsed + 10 + random() * 10;
      } else {
        if (!procGestureActive) {
          if (elapsed >= procNextGestureTime) {
            procGestureActive = true;
            procGestureStartTime = elapsed;
            procGestureDuration = 3.2 + random() * 1.2;
            if (isSpeaking) {
              const p = random();
              currentProcGesture = p < 0.45 ? 'explain_right' : p < 0.8 ? 'explain_left' : 'ponder';
              procNextGestureTime = elapsed + procGestureDuration + 14 + random() * 16;
            } else if (state === 'thinking') {
              currentProcGesture = 'ponder';
              procNextGestureTime = elapsed + procGestureDuration + 18 + random() * 18;
            } else {
              currentProcGesture = 'rest_shift';
              procNextGestureTime = elapsed + procGestureDuration + 25 + random() * 25;
            }
          }
        } else if (elapsed >= procGestureStartTime + procGestureDuration) {
          procGestureActive = false;
        }
      }

      let gestureWeight = 0;
      if (procGestureActive) {
        const progress = Math.max(0, Math.min(1, (elapsed - procGestureStartTime) / procGestureDuration));
        gestureWeight = Math.sin(progress * Math.PI);
      }

      let tgtLeftUpper = [0.08, 0, 1.25 * armZSign];
      let tgtRightUpper = [0.08, 0, -1.25 * armZSign];
      let tgtLeftLower = [0, 0.15, 0.1 * armZSign];
      let tgtRightLower = [0, -0.15, -0.1 * armZSign];
      let tgtLeftHand = [0.05, 0.1, 0.05 * armZSign];
      let tgtRightHand = [0.05, -0.1, -0.05 * armZSign];

      if (gestureWeight > 0.001) {
        switch (currentProcGesture) {
          case 'explain_right':
            tgtRightUpper = [0.08 + 0.16 * gestureWeight, 0.08 * gestureWeight, (-1.25 + 0.22 * gestureWeight) * armZSign];
            tgtRightLower = [0.32 * gestureWeight, -0.15 - 0.12 * gestureWeight, -0.1 * armZSign];
            tgtRightHand = [0.05 + 0.12 * gestureWeight, -0.1 - 0.12 * gestureWeight, (-0.05 - 0.08 * gestureWeight) * armZSign];
            break;
          case 'explain_left':
            tgtLeftUpper = [0.08 + 0.16 * gestureWeight, -0.08 * gestureWeight, (1.25 - 0.22 * gestureWeight) * armZSign];
            tgtLeftLower = [0.32 * gestureWeight, 0.15 + 0.12 * gestureWeight, 0.1 * armZSign];
            tgtLeftHand = [0.05 + 0.12 * gestureWeight, 0.1 + 0.12 * gestureWeight, (0.05 + 0.08 * gestureWeight) * armZSign];
            break;
          case 'ponder':
            tgtRightUpper = [0.08 + 0.12 * gestureWeight, 0.04 * gestureWeight, (-1.25 + 0.15 * gestureWeight) * armZSign];
            tgtRightLower = [0.42 * gestureWeight, -0.15 - 0.18 * gestureWeight, (-0.1 - 0.05 * gestureWeight) * armZSign];
            tgtRightHand = [0.05 + 0.15 * gestureWeight, -0.1 - 0.08 * gestureWeight, -0.05 * armZSign];
            break;
          case 'rest_shift':
            tgtLeftUpper = [0.09 * gestureWeight + 0.08 * (1 - gestureWeight), 0, (1.23 * gestureWeight + 1.25 * (1 - gestureWeight)) * armZSign];
            tgtRightUpper = [0.07 * gestureWeight + 0.08 * (1 - gestureWeight), 0, (-1.27 * gestureWeight + -1.25 * (1 - gestureWeight)) * armZSign];
            tgtLeftLower = [0.04 * gestureWeight, 0.18 * gestureWeight + 0.15 * (1 - gestureWeight), 0.1 * armZSign];
            tgtRightLower = [-0.02 * gestureWeight, -0.13 * gestureWeight + -0.15 * (1 - gestureWeight), -0.1 * armZSign];
            tgtLeftHand = [0.07 * gestureWeight + 0.05 * (1 - gestureWeight), 0.12 * gestureWeight + 0.1 * (1 - gestureWeight), 0.05 * armZSign];
            tgtRightHand = [0.04 * gestureWeight + 0.05 * (1 - gestureWeight), -0.08 * gestureWeight + -0.1 * (1 - gestureWeight), -0.05 * armZSign];
            break;
        }
      }

      curLeftUpper = [damp(curLeftUpper[0], tgtLeftUpper[0], dt, 5), damp(curLeftUpper[1], tgtLeftUpper[1], dt, 5), damp(curLeftUpper[2], tgtLeftUpper[2], dt, 5)];
      curRightUpper = [damp(curRightUpper[0], tgtRightUpper[0], dt, 5), damp(curRightUpper[1], tgtRightUpper[1], dt, 5), damp(curRightUpper[2], tgtRightUpper[2], dt, 5)];
      curLeftLower = [damp(curLeftLower[0], tgtLeftLower[0], dt, 5), damp(curLeftLower[1], tgtLeftLower[1], dt, 5), damp(curLeftLower[2], tgtLeftLower[2], dt, 5)];
      curRightLower = [damp(curRightLower[0], tgtRightLower[0], dt, 5), damp(curRightLower[1], tgtRightLower[1], dt, 5), damp(curRightLower[2], tgtRightLower[2], dt, 5)];
      curLeftHand = [damp(curLeftHand[0], tgtLeftHand[0], dt, 5), damp(curLeftHand[1], tgtLeftHand[1], dt, 5), damp(curLeftHand[2], tgtLeftHand[2], dt, 5)];
      curRightHand = [damp(curRightHand[0], tgtRightHand[0], dt, 5), damp(curRightHand[1], tgtRightHand[1], dt, 5), damp(curRightHand[2], tgtRightHand[2], dt, 5)];

      if (leftUpperArm && leftUpperArm !== chest) {
        leftUpperArm.rotation.set(curLeftUpper[0], curLeftUpper[1], curLeftUpper[2] - armSway * armZSign);
      }
      if (rightUpperArm && rightUpperArm !== chest) {
        rightUpperArm.rotation.set(curRightUpper[0], curRightUpper[1], curRightUpper[2] + armSway * armZSign);
      }
      if (leftLowerArm && leftLowerArm !== chest && leftLowerArm !== leftUpperArm) {
        leftLowerArm.rotation.set(curLeftLower[0], curLeftLower[1], curLeftLower[2]);
      }
      if (rightLowerArm && rightLowerArm !== chest && rightLowerArm !== rightUpperArm) {
        rightLowerArm.rotation.set(curRightLower[0], curRightLower[1], curRightLower[2]);
      }
      if (leftHand && leftHand !== chest && leftHand !== leftUpperArm && leftHand !== leftLowerArm) {
        leftHand.rotation.set(curLeftHand[0], curLeftHand[1], curLeftHand[2]);
      }
      if (rightHand && rightHand !== chest && rightHand !== rightUpperArm && rightHand !== rightLowerArm) {
        rightHand.rotation.set(curRightHand[0], curRightHand[1], curRightHand[2]);
      }
    }

    // 7. Head posture (blends procedural speech bobbing & sleeping tilt)
    let targetPitch = 0;
    let targetYaw = 0;
    let targetRoll = 0;

    switch (state) {
      case 'sleeping':
        targetPitch = 0.16;
        targetYaw = 0.02;
        targetRoll = 0.06;
        break;
      case 'listening':
        targetPitch = 0.05;
        targetYaw = 0.03;
        targetRoll = 0.07;
        break;
      case 'thinking':
        targetPitch = -0.07;
        targetYaw = 0.09;
        targetRoll = -0.04;
        break;
      case 'speaking':
      case 'speaking_alt': {
        const speechBob = Math.sin(elapsed * 4.2) * (mouth * 0.045);
        targetPitch = speechBob;
        targetYaw = Math.sin(elapsed * 2.1) * 0.03;
        targetRoll = Math.sin(elapsed * 1.5) * 0.015;
        break;
      }
      case 'angry':
        targetPitch = 0.10;
        targetYaw = 0;
        targetRoll = 0;
        break;
      case 'error':
        targetPitch = 0.12;
        targetYaw = 0;
        targetRoll = -0.05;
        break;
      case 'idle':
      default:
        targetPitch = Math.sin(elapsed * 0.8) * 0.015;
        targetYaw = Math.sin(elapsed * 0.5) * 0.02;
        targetRoll = Math.sin(elapsed * 0.6) * 0.01;
        break;
    }

    // 7b. Mouse gaze and head tracking
    const isMouseActive = !isSleeping && Boolean(mouse?.active);
    const targetNormX = isMouseActive ? Math.max(-1.8, Math.min(1.8, mouse?.x ?? 0)) : 0;
    const targetNormY = isMouseActive ? Math.max(-1.8, Math.min(1.8, mouse?.y ?? 0)) : 0;

    curMouseNormX = damp(curMouseNormX, targetNormX, dt, 4);
    curMouseNormY = damp(curMouseNormY, targetNormY, dt, 4);

    const mouseHeadYaw = curMouseNormX * 0.12;
    const mouseHeadPitch = -curMouseNormY * 0.08;

    curMouseYaw = damp(curMouseYaw, mouseHeadYaw, dt, 4);
    curMousePitch = damp(curMousePitch, mouseHeadPitch, dt, 4);

    curHeadPitch = damp(curHeadPitch, targetPitch, dt, 5);
    curHeadYaw = damp(curHeadYaw, targetYaw, dt, 5);
    curHeadRoll = damp(curHeadRoll, targetRoll, dt, 5);

    const poseOwnsHead = Boolean(activeGestureAction ||
      (activeIdleAction && !isBaseIdleUrl(activeIdleUrl)));
    if (head && head !== chest) {
      const isActionRunning = Boolean(activeIdleAction?.isRunning() || activeGestureAction?.isRunning() ||
        (holdGesture && activeGestureAction));
      if (hasVrma && !isSleeping && isActionRunning) {
        // Base pose cleanly inherited from active VRMA mixer track
        const basePoseX = head.rotation.x;
        const basePoseY = head.rotation.y;
        const basePoseZ = head.rotation.z;

        // Do not add mouse gaze / speech bobbing during greeting bow so head naturally follows animation
        const pitchAdd = poseOwnsHead ? 0 : curHeadPitch + curMousePitch;
        const yawAdd = poseOwnsHead ? 0 : curHeadYaw + curMouseYaw;
        const rollAdd = poseOwnsHead ? 0 : curHeadRoll;

        head.rotation.x += pitchAdd;
        head.rotation.y += yawAdd;
        head.rotation.z += rollAdd;

        // Bound only procedural offsets; authored VRMA poses own their rotations.
        head.rotation.x = basePoseX + Math.max(-0.22, Math.min(0.35, pitchAdd));
        head.rotation.y = basePoseY + Math.max(-0.65, Math.min(0.65, yawAdd));
        head.rotation.z = basePoseZ + Math.max(-0.12, Math.min(0.12, rollAdd));

        // Deduce exact net additive offset to subtract on next frame (immune to compounding/drift)
        prevAddPitch = head.rotation.x - basePoseX;
        prevAddYaw = head.rotation.y - basePoseY;
        prevAddRoll = head.rotation.z - basePoseZ;
      } else {
        prevAddPitch = 0;
        prevAddYaw = 0;
        prevAddRoll = 0;
        head.rotation.x = restHeadX + curHeadPitch + (isSleeping ? 0 : curMousePitch);
        head.rotation.y = restHeadY + curHeadYaw + (isSleeping ? 0 : curMouseYaw);
        head.rotation.z = restHeadZ + curHeadRoll;

        const maxForward = isSleeping ? restHeadX + 0.22 : restHeadX + 0.35;
        const maxBackward = restHeadX - 0.22;
        head.rotation.x = Math.max(maxBackward, Math.min(maxForward, head.rotation.x));
        head.rotation.y = Math.max(restHeadY - 0.65, Math.min(restHeadY + 0.65, head.rotation.y));
        head.rotation.z = Math.max(restHeadZ - 0.12, Math.min(restHeadZ + 0.12, head.rotation.z));
      }
    }

    if ((!hasVrma || isSleeping) && neck && neck !== chest && neck !== head) {
      // Natural neck bend limit matching bowing spine
      neck.rotation.x = Math.max(restNeckX - 0.20, Math.min(restNeckX + 0.35, neck.rotation.x));
    }

    // 8. State-driven facial expressions
    let tgtHappy = 0;
    let tgtRelaxed = 0;
    let tgtAngry = 0;
    let tgtSad = 0;
    let tgtSurprised = 0;

    switch (state) {
      case 'sleeping':
        tgtRelaxed = 0.6;
        break;
      case 'listening':
        break;
      case 'thinking':
        break;
      case 'speaking':
      case 'speaking_alt':
        if (audioActive) tgtHappy = 0.22;
        break;
      case 'angry':
        tgtAngry = 0.7;
        break;
      case 'error':
        tgtSad = 0.6;
        break;
      case 'idle':
      default:
        // Neutral facial expression: keeps mouth completely closed in idle
        break;
    }

    const happyLambda = tgtHappy === 0 ? 12 : 6;
    const relaxedLambda = tgtRelaxed === 0 ? 12 : 6;
    curHappy = damp(curHappy, tgtHappy, dt, happyLambda);
    curRelaxed = damp(curRelaxed, tgtRelaxed, dt, relaxedLambda);
    curAngry = damp(curAngry, tgtAngry, dt, 6);
    curSad = damp(curSad, tgtSad, dt, 6);
    curSurprised = damp(curSurprised, tgtSurprised, dt, 6);

    // Expression morphs on Kira v3 affect mouth vertices independently of aa/oh.
    // A state transition or source end must neutralize them on this frame, not
    // wait for damping or a non-zero waveform sample.
    if (!isSpeaking || !audioActive) curHappy = 0;
    if (state !== 'sleeping') curRelaxed = 0;
    if (state === 'thinking' || state === 'listening' || isSpeaking) curSurprised = 0;

    if (curHappy < 0.005) curHappy = 0;
    if (curRelaxed < 0.005) curRelaxed = 0;

    vrm.expressionManager?.setValue('happy', curHappy);
    vrm.expressionManager?.setValue('relaxed', curRelaxed);
    vrm.expressionManager?.setValue('angry', curAngry);
    vrm.expressionManager?.setValue('sad', curSad);
    vrm.expressionManager?.setValue('surprised', curSurprised);

    // 9. Blinking: forced closed during sleep, natural periodic blink when awake
    if (state === 'sleeping') {
      blinkVal = damp(blinkVal, 1.0, dt, 6);
    } else {
      if (elapsed > nextBlink + 0.15) nextBlink = elapsed + 3 + random() * 3;
      const naturalBlink = elapsed < nextBlink ? 0 : Math.sin((Math.PI * (elapsed - nextBlink)) / 0.15);
      blinkVal = damp(blinkVal, Math.max(0, naturalBlink), dt, 20);
    }
    vrm.expressionManager?.setValue('blink', blinkVal);

    // 10. Real-time Lip Sync
    // Prevent unnatural jaw dislocation on sensitive VRM models (e.g. 6540917267340780975.vrm)
    // by capping maximum opening to 0.65 and snapping lips completely closed during sleep or deadband (< 0.03).
    //
    // The analyser may retain a non-zero sample after playback ends, while
    // the visual state may lag behind the first clip. Source activity, not the
    // polled speaking state or sample alone, owns the viseme gate.
    const activeMouth = audioActive && Number.isFinite(mouth) ? Math.max(0, mouth) : 0;
    const mouthOpen = state === 'sleeping' ? 0 : Math.min(0.75, activeMouth);
    const oh = mouthOpen * 0.2;
    vrm.expressionManager?.setValue('aa', mouthOpen);
    vrm.expressionManager?.setValue('oh', oh);
    if (observeLipSyncFrame && frameId !== undefined) {
      const gateReason: VrmMouthGate = state === 'sleeping'
        ? 'sleeping'
        : !audioActive ? 'audio_inactive' : mouthOpen === 0 ? 'deadband' : 'open';
      try { observeLipSyncFrame(surface, frameId, mouth, audioActive, state, activeMouth, mouthOpen, mouthOpen, oh, gateReason); }
      catch { /* Diagnostic observers cannot alter animation output. */ }
    }

    if (vrm.lookAt && headNode) {
      // The solver reads RAW bones, after normalized-to-raw propagation. Its face
      // basis accounts for rest orientation and VRM 0 (-Z) versus VRM 1 (+Z).
      vrm.humanoid?.update?.();
      vrm.scene.updateMatrixWorld(true);
      vrm.lookAt.getLookAtWorldPosition(tempHeadPos);
      vrm.lookAt.getLookAtWorldQuaternion(tempHeadQuat);
      vrm.lookAt.getFaceFrontQuaternion(tempFaceQuat);
      const gazeGrip = poseOwnsHead ? 0 : 1;
      tempForward.set(curMouseNormX * 0.35 * gazeGrip, curMouseNormY * 0.25 * gazeGrip, 1.5)
        .applyQuaternion(tempFaceQuat).applyQuaternion(tempHeadQuat);
      lookAtTarget.position.copy(tempHeadPos).add(tempForward);
      // Target is parented under scene, not world (VRM0 rotates this root).
      vrm.scene.worldToLocal(lookAtTarget.position);
    }
    vrm.update(dt);
  };

  tick.isGreeting = () => isGreetingActive;

  tick.playCustomAnimation = async (
    url: string | null,
    onFinished?: () => void,
    options?: { hold?: boolean }
  ): Promise<number> => {
    const request = ++customRequest;
    cancelCustomWaiter();
    holdGesture = false;
    if (disposed) return 0;
    try {
      if (!url) {
        if (activeGestureAction) {
          activeGestureAction.fadeOut(0.4);
          activeGestureAction = null;
        }
        if (activeIdleAction && !isSleeping) {
          activeIdleAction.reset().setEffectiveWeight(1).fadeIn(0.4).play();
          activeIdleStart = elapsed;
        }
        return 0;
      }

      let clip = clips.get(url);
      if (!clip) {
        clip = (await loadVrmaClipSafe(url, vrm)) ?? undefined;
        if (disposed || request !== customRequest) return 0;
        if (clip) clips.set(url, clip);
      }
      if (!clip) {
        onFinished?.();
        return 0;
      }

      if (activeGestureAction) {
        activeGestureAction.stop();
        activeGestureAction = null;
      }

      const action = mixer.clipAction(clip);
      const isBaseLoop = isBaseIdleUrl(url);

      if (isBaseLoop) {
        if (action === activeIdleAction) {
          action.setEffectiveWeight(1);
          if (!action.isRunning()) action.play();
        } else {
          action.reset().setLoop(LoopRepeat, Infinity);
          action.clampWhenFinished = false;
          action.setEffectiveWeight(1).fadeIn(0.2).play();
          if (activeIdleAction && activeIdleAction !== action) {
            activeIdleAction.fadeOut(0.2);
          }
        }
        activeIdleAction = action;
        activeIdleUrl = url;
        activeIdleStart = elapsed;
        activeIdleDuration = calculateIdleDwell(url, clip.duration);
        hasVrma = true;

        // For looping base idle in QA tests, sample for 4s then signal finished
        const sampleMs = 4000;
        customAnimResolver = onFinished ?? null;
        customAnimTimeout = setTimeout(completeCustomWaiter, sampleMs);

        return clip.duration;
      }

      action.reset().setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(1).fadeIn(0.2).play();
      if (activeIdleAction && activeIdleAction !== action) {
        activeIdleAction.fadeOut(0.2);
      }

      activeGestureAction = action;
      activeGestureDuration = Math.max(1.0, clip.duration);
      hasVrma = true;
      if (options?.hold) {
        holdGesture = true;
        return activeGestureDuration;
      }

      // Register callback to be triggered when action emits 'finished'
      customAnimResolver = () => {
        onFinished?.();
      };
      // Defensive timeout: clip duration + 1.2s crossfade buffer
      customAnimTimeout = setTimeout(() => {
        finishGesture();
        completeCustomWaiter();
      }, (activeGestureDuration + 1.2) * 1000);

      return activeGestureDuration;
    } catch {
      if (disposed || request !== customRequest) return 0;
      onFinished?.();
      return 0;
    }
  };

  tick.dispose = () => {
    disposed = true;
    ++customRequest;
    cancelCustomWaiter();
    mixer.removeEventListener('finished', onActionFinished as unknown as (event: import('three').Event) => void);
    mixer.stopAllAction();
    mixer.uncacheRoot(mixerRoot);
    if (vrm.lookAt && vrm.lookAt.target === lookAtTarget) {
      vrm.lookAt.target = null;
    }
    lookAtTarget.removeFromParent();
  };

  return tick;
}
