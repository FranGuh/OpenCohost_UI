import { LoadingManager, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import * as vrmRuntime from '@pixiv/three-vrm';

// Upstream's directory re-export lacks an extension under NodeNext. Keep
// the compatibility assertion local instead of changing the app's resolver.
const VRMUtils = (vrmRuntime as unknown as { VRMUtils: {
  rotateVRM0: (vrm: VRM) => void; deepDispose: (object: Object3D) => void;
} }).VRMUtils;

export function createVrmLoader(allowedUrl: string, onItemError?: (url: string) => void): GLTFLoader {
  const manager = new LoadingManager();
  if (onItemError) manager.onError = onItemError;
  // VRM is self-contained GLB. Do not permit embedded external resource URLs.
  manager.setURLModifier(resource => {
    if (resource !== allowedUrl && !resource.startsWith('blob:') && !resource.startsWith('data:')) throw new Error('External model resources are unsupported');
    return resource;
  });
  const loader = new GLTFLoader(manager);
  loader.register(parser => new VRMLoaderPlugin(parser));
  return loader;
}

function finishVrm(gltf: { scene: Object3D; userData: Record<string, unknown> }): VRM {
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) { VRMUtils.deepDispose(gltf.scene); throw new Error('File is not a VRM avatar'); }
  VRMUtils.rotateVRM0(vrm);
  return vrm;
}

export async function loadVrm(url: string): Promise<VRM> {
  return finishVrm(await createVrmLoader(url).loadAsync(url));
}

/** Parse an already-downloaded VRM (e.g. fetched with an Authorization header). */
export async function loadVrmFromBuffer(buffer: ArrayBuffer, onItemError?: (url: string) => void): Promise<VRM> {
  const gltf = await createVrmLoader('', onItemError).parseAsync(buffer, '');
  return finishVrm(gltf);
}
export type FramingMode = 'full' | 'half' | 'head';

export function calculateFraming(vrm: VRM, mode: FramingMode = 'full') {
  vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid?.getNormalizedBoneNode('head')?.getWorldPosition(new Vector3());
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips')?.getWorldPosition(new Vector3());
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest')?.getWorldPosition(new Vector3())
    ?? vrm.humanoid?.getNormalizedBoneNode('spine')?.getWorldPosition(new Vector3());

  const headY = head?.y ?? 1.4;
  const hipsY = hips?.y ?? (headY - 0.6);
  const headX = head?.x ?? 0;
  const headZ = head?.z ?? 0;

  if (mode === 'head') {
    const target = new Vector3(headX, headY - 0.02, headZ);
    return { target, distance: 1.0 };
  }

  if (mode === 'half') {
    // Navel to head: navel at lower third/bottom edge, head framed comfortably
    const target = new Vector3(headX, headY - 0.16, headZ);
    return { target, distance: 1.85 };
  }

  // 'full': Feet to head (cuerpo completo) - lowered to window bottom, generous headroom
  const target = new Vector3(headX, headY * 0.65, headZ);
  return { target, distance: 3.85 };
}

export function portraitFraming(vrm: VRM) {
  vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid?.getNormalizedBoneNode('head')?.getWorldPosition(new Vector3());
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips')?.getWorldPosition(new Vector3());
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest')?.getWorldPosition(new Vector3())
    ?? vrm.humanoid?.getNormalizedBoneNode('spine')?.getWorldPosition(new Vector3());

  if (head && (hips || chest)) {
    const lower = hips ?? chest!;
    const span = Math.max(0.35, head.y - lower.y);
    const target = new Vector3(head.x, head.y - span * 0.45, head.z);
    const height = span * 1.75;
    const distance = (height / 2) / Math.tan((30 * Math.PI) / 360);
    return { target, distance: Math.max(1.6, distance) };
  }

  const fallback = head ?? new Vector3(0, 1.4, 0);
  return { target: new Vector3(fallback.x, fallback.y - 0.2, fallback.z), distance: 2.0 };
}

export function portraitTarget(vrm: VRM) {
  return portraitFraming(vrm).target;
}
export function disposeVrm(vrm: VRM) { VRMUtils.deepDispose(vrm.scene); }
