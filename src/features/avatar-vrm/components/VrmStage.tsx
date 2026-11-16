import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  CanvasTexture,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { animator, type LipSyncFrameObserver, type LookAtTarget, type VrmAnimatorInstance } from '../domain/vrmAnimator.js';
import { shouldRender, targetFps } from '../domain/frameBudget.js';
import { resolveActionAnimation } from '../domain/lookAnimation.js';
import { disposeVrm, loadVrm, portraitFraming, portraitTarget, calculateFraming, type FramingMode } from '../domain/vrmLoader.js';
import { vrmDiagnostics, type VrmDiagnosticSurface } from '../domain/vrmDiagnostics.js';

const recordLipSyncFrame: LipSyncFrameObserver = (surface, frameId, inputMouth, audioActive, state, activeMouth, mouthOpen, aa, oh, gateReason) => {
  vrmDiagnostics.recordFrame(surface, frameId, inputMouth, audioActive, state, activeMouth, mouthOpen, aa, oh, gateReason);
};

function createContactShadowTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(10, 16, 26, 0.45)');
    gradient.addColorStop(0.35, 'rgba(10, 16, 26, 0.28)');
    gradient.addColorStop(0.65, 'rgba(10, 16, 26, 0.08)');
    gradient.addColorStop(1, 'rgba(10, 16, 26, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}

export function VrmStage({
  url,
  sample,
  diagnosticSurface = 'unknown',
  isAudioActive = () => false,
  onError,
  state = 'idle',
  active = true,
  framingMode = 'half',
  distanceMultiplier = 1.0,
  qaAnimationUrl = null,
  looking = false,
  onQaAnimationFinished,
}: {
  url: string;
  sample: (frameId?: number, deltaSeconds?: number) => number;
  diagnosticSurface?: VrmDiagnosticSurface;
  isAudioActive?: () => boolean;
  onError: (message: string) => void;
  state?: string;
  active?: boolean;
  framingMode?: FramingMode;
  distanceMultiplier?: number;
  qaAnimationUrl?: string | null;
  /** Vision look in flight: plays the smartphone pose (calm states only). */
  looking?: boolean;
  onQaAnimationFinished?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const diagnosticSurfaceRef = useRef(diagnosticSurface);
  diagnosticSurfaceRef.current = diagnosticSurface;
  const isAudioActiveRef = useRef(isAudioActive);
  isAudioActiveRef.current = isAudioActive;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeRef = useRef(active);
  activeRef.current = active;
  const framingModeRef = useRef(framingMode);
  framingModeRef.current = framingMode;
  const distanceMultiplierRef = useRef(distanceMultiplier);
  distanceMultiplierRef.current = distanceMultiplier;
  const actionUrl = resolveActionAnimation({ looking, state, qaUrl: qaAnimationUrl });
  const qaAnimationUrlRef = useRef(actionUrl);
  qaAnimationUrlRef.current = actionUrl;
  // A look pose is held for the whole look (ended by actionUrl -> null); QA clips play once.
  const holdActionRef = useRef(false);
  holdActionRef.current = Boolean(actionUrl) && !qaAnimationUrl;
  const onQaAnimationFinishedRef = useRef(onQaAnimationFinished);
  onQaAnimationFinishedRef.current = onQaAnimationFinished;
  const resumeRenderRef = useRef<(() => void) | null>(null);
  const buildRef = useRef<(() => void) | null>(null);
  const updateFramingRef = useRef<((mode: FramingMode) => void) | null>(null);
  const playCustomAnimationRef = useRef<((url: string | null, onFinished?: () => void, hold?: boolean) => void) | null>(null);

  useEffect(() => {
    updateFramingRef.current?.(framingMode);
  }, [framingMode, distanceMultiplier]);

  useEffect(() => {
    playCustomAnimationRef.current?.(actionUrl, onQaAnimationFinishedRef.current, holdActionRef.current);
    return () => { playCustomAnimationRef.current?.(null); };
  }, [actionUrl]);

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      if (resumeRenderRef.current) {
        resumeRenderRef.current();
      } else {
        buildRef.current?.();
      }
    }
  }, [active]);

  useEffect(() => {
    const element = canvas.current!;
    let disposed = false;
    let generation = 0;
    let frame = 0;
    let renderer: WebGLRenderer | undefined;
    let avatar: VRM | undefined;
    let contactShadowMesh: Mesh | undefined;
    let currentTick: VrmAnimatorInstance | undefined;
    let diagnosticFrameId = 0;
    let lightTimer: ReturnType<typeof setTimeout> | undefined;
    let mouseTargetX = 0;
    let mouseTargetY = 0;
    let mouseActive = false;
    let mouseTimer: ReturnType<typeof setTimeout> | undefined;

    const onPointerMove = (e: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        mouseTargetX = Math.max(-1.8, Math.min(1.8, (e.clientX - cx) / (rect.width / 2)));
        mouseTargetY = Math.max(-1.8, Math.min(1.8, -((e.clientY - cy) / (rect.height / 2))));
        mouseActive = true;
      }
      if (mouseTimer) clearTimeout(mouseTimer);
      mouseTimer = setTimeout(() => {
        mouseActive = false;
      }, 3500);
    };

    const onPointerLeave = () => {
      mouseActive = false;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);

    const clear = () => {
      cancelAnimationFrame(frame);
      updateFramingRef.current = null;
      playCustomAnimationRef.current = null;
      if (mouseTimer) {
        clearTimeout(mouseTimer);
        mouseTimer = undefined;
      }
      if (lightTimer) {
        clearTimeout(lightTimer);
        lightTimer = undefined;
      }
      if (currentTick?.dispose) {
        currentTick.dispose();
        currentTick = undefined;
      }
      if (contactShadowMesh) {
        contactShadowMesh.geometry.dispose();
        if (Array.isArray(contactShadowMesh.material)) {
          contactShadowMesh.material.forEach((m) => {
            if ('map' in m && (m as any).map) (m as any).map.dispose();
            m.dispose();
          });
        } else {
          const mat = contactShadowMesh.material as any;
          if ('map' in mat && mat.map) {
            mat.map.dispose();
          }
          contactShadowMesh.material.dispose();
        }
        contactShadowMesh = undefined;
      }
      if (avatar) disposeVrm(avatar);
      avatar = undefined;
      if (renderer) {
        renderer.dispose();
        renderer = undefined;
      }
    };
    const build = async () => {
      const version = ++generation;
      clear();
      try {
        const current = new WebGLRenderer({ canvas: element, alpha: true, antialias: true, premultipliedAlpha: false });
        renderer = current;
        current.setClearColor(0x000000, 0);
        current.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        const scene = new Scene();
        const ambient = new AmbientLight(0xf0f4f8, 1.1);
        scene.add(ambient);
        const key = new DirectionalLight(0xfffbf5, 1.5);
        key.position.set(1, 2, 3);
        scene.add(key);
        const fill = new DirectionalLight(0xdde8f5, 1.0);
        fill.position.set(-1, 1, 3);
        scene.add(fill);

        let wasSleeping = stateRef.current === 'sleeping';
        let lightTarget = wasSleeping ? 0.05 : 1.0;
        let currentLight = lightTarget;

        const camera = new PerspectiveCamera(30, 1, 0.01, 100);
        const loaded = await loadVrm(url);
        if (disposed || version !== generation) { disposeVrm(loaded); return; }
        avatar = loaded;
        loaded.scene.traverse((child: import('three').Object3D) => {
          if ('isMesh' in child && (child as Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = false;
            // Prevent Three.js from culling animated skinned meshes when bounding sphere leaves frustum
            child.frustumCulled = false;
          }
        });
        scene.add(loaded.scene);

        // Ground contact shadow: soft radial disc centered under Kira's feet to ground the model
        // without projecting stretched silhouette artifacts or hard clipped rectangular edges.
        const contactTexture = createContactShadowTexture();
        if (contactTexture) {
          const shadowGeo = new PlaneGeometry(0.95, 0.6);
          const shadowMat = new MeshBasicMaterial({
            map: contactTexture,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
          });
          const contactPlane = new Mesh(shadowGeo, shadowMat);
          contactPlane.rotation.x = -Math.PI / 2;
          contactPlane.position.set(0, 0.001, 0);
          scene.add(contactPlane);
          contactShadowMesh = contactPlane;
        }
        const desiredLook = new Vector3();
        const desiredPos = new Vector3();
        const currentLook = new Vector3();
        const liveHeadPos = new Vector3();
        const liveTorsoPos = new Vector3();
        const liveTarget = new Vector3();
        let currentBaseDistance = 2.05;

        const applyFraming = (mode: FramingMode, instant = false) => {
          if (!loaded) return;
          const mult = distanceMultiplierRef.current ?? 1.0;
          const { target, distance } = calculateFraming(loaded, mode);
          currentBaseDistance = distance;
          desiredLook.copy(target);
          desiredPos.set(target.x, target.y, target.z + distance * mult);
          if (instant) {
            currentLook.copy(desiredLook);
            camera.position.copy(desiredPos);
            camera.lookAt(currentLook);
          }
        };

        applyFraming(framingModeRef.current, true);
        // The framing above measures the raw bind pose. Re-apply it instantly after the
        // next animated tick (and after every resume from a suspended loop) so neither the
        // bind pose nor a pre-suspend camera can remain the framing that sticks.
        let reframeAfterTick = true;
        updateFramingRef.current = (mode: FramingMode) => applyFraming(mode, false);
        const tick = animator(loaded);
        currentTick = tick;
        playCustomAnimationRef.current = (url: string | null, onFinished?: () => void, hold?: boolean) => {
          void tick.playCustomAnimation(url, () => {
            if (!disposed && version === generation) onFinished?.();
          }, { hold });
        };
        if (qaAnimationUrlRef.current) {
          playCustomAnimationRef.current(qaAnimationUrlRef.current, onQaAnimationFinishedRef.current, holdActionRef.current);
        }
        let previous = performance.now();
        let lastRender = Number.NEGATIVE_INFINITY;
        let previousWidth = 0, previousHeight = 0;
        const render = (now: number) => {
          if (disposed || version !== generation) return;
          if (!activeRef.current) {
            // Inactive (e.g. desktop companion visible or document hidden): suspend RAF to save 100% GPU
            return;
          }
          const clientWidth = element.clientWidth;
          const clientHeight = element.clientHeight;
          if (clientWidth === 0 || clientHeight === 0) {
            // Stage is hidden (e.g. user navigated to settings): skip render to save 100% GPU
            previous = now;
            frame = requestAnimationFrame(render);
            return;
          }
          // Frame budget: skip tick + render under the target fps; `previous` is left alone so
          // the next rendered frame receives the real elapsed dt (animation speed stays correct).
          if (!shouldRender(now, lastRender, targetFps(stateRef.current, isAudioActiveRef.current()))) {
            frame = requestAnimationFrame(render);
            return;
          }
          lastRender = now;
          const width = Math.max(1, clientWidth), height = Math.max(1, clientHeight);
          if (width !== previousWidth || height !== previousHeight) {
            current.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
            previousWidth = width; previousHeight = height;
          }

          const isSleeping = stateRef.current === 'sleeping';
          if (isSleeping !== wasSleeping) {
            wasSleeping = isSleeping;
            if (lightTimer) clearTimeout(lightTimer);
            lightTimer = setTimeout(() => {
              lightTarget = isSleeping ? 0.05 : 1.0;
            }, 3000);
          }

          const dt = (now - previous) / 1000;
          currentLight += (lightTarget - currentLight) * (1 - Math.exp(-3 * dt));
          ambient.intensity = 1.1 * currentLight;
          key.intensity = 1.5 * currentLight;
          if (contactShadowMesh && contactShadowMesh.material instanceof MeshBasicMaterial) {
            contactShadowMesh.material.opacity = 0.85 * currentLight;
          }
          const recordingDiagnostics = vrmDiagnostics.isRecording();
          const diagnosticFrame = recordingDiagnostics ? ++diagnosticFrameId : undefined;
          const mouth = sampleRef.current(diagnosticFrame, dt);
          const audioActive = isAudioActiveRef.current();
          tick(dt, mouth, stateRef.current, {
            x: mouseTargetX,
            y: mouseTargetY,
            active: mouseActive,
          }, audioActive, recordingDiagnostics ? recordLipSyncFrame : undefined, diagnosticFrame, diagnosticSurfaceRef.current);
          previous = now;
          if (reframeAfterTick) {
            reframeAfterTick = false;
            applyFraming(framingModeRef.current ?? 'half', true);
          }

          // Soft damped tracking: follow Kira's body movements smoothly
          // Maintains front-facing conversational relationship without orbiting her back when turning
          const headBone = loaded.humanoid?.getNormalizedBoneNode('head');
          const torsoBone = loaded.humanoid?.getNormalizedBoneNode('chest')
            ?? loaded.humanoid?.getNormalizedBoneNode('spine')
            ?? loaded.humanoid?.getNormalizedBoneNode('hips');

          if (headBone && torsoBone) {
            headBone.getWorldPosition(liveHeadPos);
            torsoBone.getWorldPosition(liveTorsoPos);

            if (contactShadowMesh) {
              contactShadowMesh.position.x = liveTorsoPos.x;
              contactShadowMesh.position.z = liveTorsoPos.z;
            }

            const mode = framingModeRef.current ?? 'half';
            const mult = distanceMultiplierRef.current ?? 1.0;

            let targetX = liveTorsoPos.x;
            let targetY = liveTorsoPos.y;
            let targetZ = liveTorsoPos.z;

            if (mode === 'head') {
              targetX = liveHeadPos.x;
              targetY = liveHeadPos.y - 0.02;
              targetZ = liveHeadPos.z;
            } else if (mode === 'half') {
              targetX = liveTorsoPos.x * 0.7 + liveHeadPos.x * 0.3;
              targetY = liveHeadPos.y - 0.16;
              targetZ = (liveTorsoPos.z + liveHeadPos.z) * 0.5;
            } else if (mode === 'full') {
              targetX = liveTorsoPos.x;
              targetY = liveHeadPos.y * 0.65;
              targetZ = liveTorsoPos.z;
            }

            liveTarget.set(targetX, targetY, targetZ);

            const isGreeting = Boolean(currentTick?.isGreeting?.());

            // -----------------------------------------------------------------
            // Face-to-Camera Safe Distance Algorithm (Dynamic Proximity Guard)
            // -----------------------------------------------------------------
            // Calculates real-time 3D spatial displacement between head and torso,
            // enforcing a minimum clearance so the camera never penetrates the face
            // or clips into the hollow mesh in any animation (e.g. gekirei, gatan, bow).
            const forwardLean = Math.max(0, liveHeadPos.z - liveTorsoPos.z);
            const baseDist = currentBaseDistance * mult;

            // Mode-specific base minimum safe distance:
            // - 'head': 1.15m upright, expanding dynamically with forward lean
            // - 'half': 1.85m upright, expanding dynamically with forward lean
            // - 'full': 3.85m full-body framing
            const minClearance = (mode === 'head' ? 1.15 : mode === 'half' ? 1.85 : 3.85) * mult;
            const dynamicSafeDistance = minClearance + (forwardLean * 1.8);

            // Minimum camera Z to maintain dynamicSafeDistance from head
            const safeZFromHead = liveHeadPos.z + dynamicSafeDistance;
            const safeZFromTorso = liveTorsoPos.z + baseDist;
            const greetingMinDist = isGreeting ? Math.max(2.85, baseDist) : baseDist;

            const targetCameraZ = Math.max(
              safeZFromHead,
              safeZFromTorso,
              desiredLook.z + greetingMinDist
            );

            if (isGreeting || forwardLean > 0.18) {
              // Frame upper body comfortably during deep bow/dip instead of sinking into hollow skull
              targetY = (liveTorsoPos.y + liveHeadPos.y) * 0.5;
            }

            liveTarget.set(targetX, targetY, targetZ);

            // Responsive damping: follow noticeable movements smoothly.
            // When rapid forward displacement occurs (forwardLean > 0.08 or greeting),
            // track immediately so the camera stays in front of the avatar.
            const isRapid = isGreeting || forwardLean > 0.08;
            if (isRapid || liveTarget.distanceToSquared(desiredLook) > 0.000025) {
              const trackFactor = isRapid ? (1 - Math.exp(-8.0 * dt)) : (1 - Math.exp(-3.5 * dt));
              desiredLook.lerp(liveTarget, trackFactor);
            }
            desiredPos.set(
              desiredLook.x,
              desiredLook.y,
              targetCameraZ
            );
          }

          const isGreetingActive = Boolean(currentTick?.isGreeting?.());
          const headZ = liveHeadPos.z;
          const minHardClearance = (framingModeRef.current === 'head' ? 1.05 : framingModeRef.current === 'half' ? 1.70 : 3.2) * (distanceMultiplierRef.current ?? 1.0);

          if (
            currentLook.distanceToSquared(desiredLook) > 0.00001 ||
            camera.position.distanceToSquared(desiredPos) > 0.00001
          ) {
            const forwardLean = Math.max(0, liveHeadPos.z - liveTorsoPos.z);
            const baseLerp = (isGreetingActive || forwardLean > 0.10) ? 0.25 : 0.08;
            // Tuned per 60 Hz frame; compensate so easing speed is independent of the frame budget.
            const lerpSpeed = 1 - Math.pow(1 - baseLerp, Math.min(dt, 0.25) * 60);
            camera.position.lerp(desiredPos, lerpSpeed);
            // Hard safety floor: camera.position.z must NEVER get closer to head than minHardClearance
            if (camera.position.z < headZ + minHardClearance) {
              camera.position.z = headZ + minHardClearance;
            }
            currentLook.lerp(desiredLook, lerpSpeed);
            camera.lookAt(currentLook);
          }
          current.render(scene, camera);
          frame = requestAnimationFrame(render);
        };
        resumeRenderRef.current = () => {
          if (disposed || version !== generation) return;
          previous = performance.now();
          lastRender = Number.NEGATIVE_INFINITY;
          reframeAfterTick = true;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(render);
        };
        frame = requestAnimationFrame(render);
      } catch { if (!disposed && version === generation) { clear(); onErrorRef.current('Could not load VRM or initialize WebGL. Check model and GPU availability.'); } }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      if (disposed) return;
      generation++; clear();
      onErrorRef.current('WebGL context lost. Waiting for GPU recovery; retry the model if rendering does not resume.');
    };
    const restored = () => { if (!disposed) void build(); };
    element.addEventListener('webglcontextlost', lost);
    element.addEventListener('webglcontextrestored', restored);
    buildRef.current = () => void build();
    void build();
    return () => {
      disposed = true; generation++;
      resumeRenderRef.current = null;
      buildRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('webglcontextlost', lost);
      element.removeEventListener('webglcontextrestored', restored);
      clear();
    };
  }, [url]);
  return <canvas ref={canvas} key={url} className="vrm-canvas block h-full w-full" aria-label="VRM avatar" />;
}
