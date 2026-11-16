import { describe, expect, it } from 'vitest';
import { loadVrmFromBuffer } from './vrmLoader.js';

describe('loadVrmFromBuffer', () => {
  it('rejects a buffer that is not a VRM/GLB', async () => {
    await expect(loadVrmFromBuffer(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toBeTruthy();
  });
});

describe('createVrmLoader item errors', () => {
  it('reports loading-manager item errors to the callback', async () => {
    const { createVrmLoader } = await import('./vrmLoader.js');
    const seen: string[] = [];
    const loader = createVrmLoader('', url => seen.push(url));
    loader.manager.itemError('blob:tex');
    expect(seen).toEqual(['blob:tex']);
  });
});
