/** WebGL stage for the phone: one VRM, idle animator, procedural mouth. Browser-only. */
import { AmbientLight, DirectionalLight, Mesh, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Object3D } from 'three';
import { animator } from '../features/avatar-vrm/domain/vrmAnimator.js';
import { shouldRender } from '../features/avatar-vrm/domain/frameBudget.js';
import { disposeVrm, loadVrmFromBuffer } from '../features/avatar-vrm/domain/vrmLoader.js';
import type { Stage, StageInputs } from './controller.js';
import { callFraming } from './framing.js';

/** Phones: fixed 30 fps budget and pixel ratio 1 (battery, thermals). */
export const PHONE_FPS = 30;

export async function startStage(canvas: HTMLCanvasElement, model: ArrayBuffer, inputs: StageInputs): Promise<Stage> {
  const vrm = await loadVrmFromBuffer(model, () => inputs.onDegraded?.());
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
  } catch (e) {
    disposeVrm(vrm);
    throw e;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);

  const scene = new Scene();
  scene.add(new AmbientLight(0xf0f4f8, 1.1));
  const key = new DirectionalLight(0xfffbf5, 1.5);
  key.position.set(1, 2, 3);
  scene.add(key);
  const fill = new DirectionalLight(0xdde8f5, 1.0);
  fill.position.set(-1, 1, 3);
  scene.add(fill);

  vrm.scene.traverse((child: Object3D) => {
    if ((child as Mesh).isMesh) child.frustumCulled = false; // skinned meshes move outside their bind bounds
  });
  scene.add(vrm.scene);

  const camera = new PerspectiveCamera(30, 1, 0.01, 100);
  const look = new Vector3();
  const headPos = new Vector3();
  const frame = () => {
    vrm.scene.updateMatrixWorld(true);
    const head = vrm.humanoid?.getNormalizedBoneNode('head')?.getWorldPosition(headPos);
    const { targetY, distance } = callFraming({ headY: head?.y ?? 1.4, aspect: camera.aspect, fovDeg: camera.fov });
    look.set(head?.x ?? 0, targetY, head?.z ?? 0);
    camera.position.set(look.x, look.y, look.z + distance);
    camera.lookAt(look);
  };
  frame();

  const tick = animator(vrm);
  let disposed = false;
  let raf = 0;
  let previous = performance.now();
  let lastRender = Number.NEGATIVE_INFINITY;
  let w = 0;
  let h = 0;
  let reframe = true;

  const loop = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) { previous = now; return; }
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === 0 || ch === 0) { previous = now; return; } // canvas hidden by the toggle
    if (!shouldRender(now, lastRender, PHONE_FPS)) return;
    lastRender = now;
    if (cw !== w || ch !== h) {
      w = cw; h = ch;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      frame(); // aspect changed (rotation, keyboard): re-fit the portrait
    }
    const dt = (now - previous) / 1000;
    previous = now;
    const speaking = inputs.mouth.speaking;
    tick(dt, inputs.mouth.value(inputs.now()), speaking ? 'speaking' : inputs.getState(), undefined, speaking);
    if (reframe) { reframe = false; frame(); } // bind pose measured above; re-measure after the first animated tick
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      disposeVrm(vrm);
      renderer.dispose();
    },
  };
}
