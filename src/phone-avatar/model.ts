/** Authenticated download of the VRM model from the gateway, with progress. */

export class ModelError extends Error {
  constructor(public readonly status: number, message = `model request failed (${status})`) {
    super(message);
    this.name = 'ModelError';
  }
}

/** progress: fraction in [0, 1], or null when the total size is unknown. */
export type ProgressFn = (fraction: number | null) => void;

export async function fetchModel(
  token: string,
  onProgress: ProgressFn,
  fetchImpl: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetchImpl('/avatar/model', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-cache',
    });
  } catch {
    throw new ModelError(0, 'model request failed (network)');
  }
  if (!res.ok) throw new ModelError(res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress(total ? Math.min(1, received / total) : null);
    }
  } catch {
    throw new ModelError(0, 'model download interrupted');
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out.buffer;
}
