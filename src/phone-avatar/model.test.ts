import { describe, expect, it, vi } from 'vitest';
import { ModelError, fetchModel } from './model.js';

function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200) {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) { if (i < chunks.length) c.enqueue(chunks[i++]); else c.close(); },
  });
  return new Response(body, { status, headers });
}
const asFetch = (f: unknown) => f as typeof fetch;

describe('fetchModel', () => {
  it('sends the bearer token, revalidates and reports progress', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      streamResponse([new Uint8Array(3), new Uint8Array(5)], { 'content-length': '8' }));
    const progress = vi.fn();
    const buf = await fetchModel('tok', progress, asFetch(fetchImpl));
    expect(buf.byteLength).toBe(8);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/avatar/model');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.cache).toBe('no-cache');
    expect(progress.mock.calls.map(c => c[0])).toEqual([3 / 8, 1]);
  });

  it('reports an unknown total as indeterminate (null)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse([new Uint8Array(4)]));
    const progress = vi.fn();
    await fetchModel('t', progress, asFetch(fetchImpl));
    expect(progress).toHaveBeenCalledWith(null);
  });

  it.each([401, 404, 500])('rejects with ModelError status %i', async status => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('x', { status }));
    await expect(fetchModel('t', () => {}, asFetch(fetchImpl)))
      .rejects.toMatchObject({ name: 'ModelError', status });
  });

  it('wraps network failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('net'));
    const err = await fetchModel('t', () => {}, asFetch(fetchImpl)).catch(e => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.status).toBe(0);
  });
});
