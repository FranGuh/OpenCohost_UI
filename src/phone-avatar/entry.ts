/** Phone avatar bundle entry (React-free). Built to opencohost/gateway/static/avatar.js. */
import { createController } from './controller.js';
import { fetchModel } from './model.js';
import { Mouth } from './mouth.js';
import { startStage } from './stage.js';

function boot(): void {
  const canvas = document.getElementById('kira-avatar');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  createController({
    target: document,
    canvas,
    mouth: new Mouth(),
    now: () => performance.now() / 1000,
    fetchModel,
    startStage,
  });
}

boot();
