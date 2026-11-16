import { AnimationClip } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  VRMLookAtQuaternionProxy,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation';
import type { VRM } from '@pixiv/three-vrm';

const vrmaCache = new Map<string, Promise<VRMAnimation>>();

export function clearVrmaCache(): void {
  vrmaCache.clear();
}

export function resolveAnimationUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:') || path.startsWith('data:')) {
    return path;
  }
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    try {
      return new URL(path, window.location.origin).href;
    } catch {
      return path;
    }
  }
  return path;
}

/**
 * Loads raw parsed VRMAnimation data from a URL with deduplication cache.
 */
export async function loadRawVrma(url: string): Promise<VRMAnimation> {
  const resolved = resolveAnimationUrl(url);
  const cached = vrmaCache.get(resolved);
  if (cached) return cached;

  const promise = (async () => {
    const loader = new GLTFLoader();
    loader.register(parser => ({
      name: 'VRMC_vrm_animation_spec_patch',
      beforeRoot: async () => {
        const json = (parser as unknown as { json?: { extensions?: { VRMC_vrm_animation?: { specVersion?: string } } } }).json;
        const ext = json?.extensions?.VRMC_vrm_animation;
        if (ext && !ext.specVersion) {
          ext.specVersion = '1.0';
        }
      },
    }));
    loader.register(parser => new VRMAnimationLoaderPlugin(parser));
    const gltf = await loader.loadAsync(resolved);
    const vrmAnimations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
    const vrmAnimation = vrmAnimations?.[0];
    if (!vrmAnimation) {
      throw new Error(`No VRMAnimation found in ${url}`);
    }
    return vrmAnimation;
  })();

  vrmaCache.set(resolved, promise);
  try {
    return await promise;
  } catch (err) {
    vrmaCache.delete(resolved);
    throw err;
  }
}

/**
 * Creates a THREE.AnimationClip tailored for a specific VRM model from a VRMA asset.
 * Keeps only humanoid skeleton tracks to preserve real-time audio lipsync and procedural blink.
 */
export async function loadVrmaClip(url: string, vrm: VRM): Promise<AnimationClip> {
  if (!vrm.meta) {
    (vrm as unknown as { meta: { metaVersion: '0' | '1' } }).meta = { metaVersion: '0' };
  }
  // Create VRMLookAtQuaternionProxy if not already present on vrm.scene to suppress Pixiv console warning
  if (vrm.lookAt && vrm.scene && !vrm.scene.children.some((obj: import('three').Object3D) => obj.name === 'VRMLookAtQuaternionProxy')) {
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = 'VRMLookAtQuaternionProxy';
    vrm.scene.add(proxy);
  }
  const rawAnimation = await loadRawVrma(url);
  const fullClip = createVRMAnimationClip(rawAnimation, vrm);

  // Retain only body skeleton tracks.
  // Strip expression tracks (.weight), VRMA lookAt proxy tracks, and direct eye rotations
  // so OpenCohost's real-time interactive gaze and blink algorithms maintain exclusive authority.
  const skeletonTracks = fullClip.tracks.filter((track: import('three').KeyframeTrack) => {
    if (track.name.includes('.weight')) return false;
    if (track.name.includes('VRMLookAtQuaternionProxy')) return false;
    if (track.name.includes('leftEye') || track.name.includes('rightEye')) return false;
    return true;
  });
  const duration = fullClip.duration > 0 ? fullClip.duration : -1;
  const clip = new AnimationClip(fullClip.name || url, duration, skeletonTracks);
  if (clip.duration <= 0) {
    clip.resetDuration();
  }
  return clip;
}

/**
 * Safely loads a clip without throwing, returning null if loading fails.
 */
export async function loadVrmaClipSafe(url: string, vrm: VRM): Promise<AnimationClip | null> {
  try {
    return await loadVrmaClip(url, vrm);
  } catch (error) {
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
      console.warn(`[VRMA] Failed to load animation clip from ${url}:`, error);
    }
    return null;
  }
}
