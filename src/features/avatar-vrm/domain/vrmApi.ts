export type AudioState = { sequence: number; active: boolean; elapsed_ms: number };
export type ModelInfo = { filename: string; size_mb: number; modified_at: number };

export function localBackend(value = 'http://127.0.0.1:8765'): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Backend must be a loopback origin');
  return url.origin;
}

export class VrmApi {
  readonly base: string;
  private readonly readToken: () => string;
  constructor(
    base: string,
    token: string | (() => string) = '',
    private readonly refreshToken?: () => Promise<string | null>,
  ) {
    this.base = localBackend(base);
    this.readToken = typeof token === 'function' ? token : () => token;
  }
  async request(path: string, signal?: AbortSignal, authenticated = false) {
    const response = await fetch(`${this.base}/api/avatar/vrm/${path}`, {
      signal, cache: 'no-store', redirect: 'error',
      headers: authenticated ? { Authorization: `Bearer ${this.readToken()}` } : {},
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Operator token required' : `Avatar request failed (${response.status})`);
    return response;
  }
  async state(signal: AbortSignal): Promise<AudioState> {
    const state = await (await this.request('audio/state', signal)).json();
    if (!Number.isSafeInteger(state.sequence) || typeof state.active !== 'boolean' || !Number.isFinite(state.elapsed_ms) || state.elapsed_ms < 0) throw new Error('Invalid audio state');
    return state;
  }
  async audio(sequence: number, signal: AbortSignal): Promise<ArrayBuffer | null> {
    const fetchChunk = (bearer: string) =>
      fetch(`${this.base}/api/avatar/vrm/audio/last?sequence=${sequence}`, {
        signal, cache: 'no-store', redirect: 'error',
        headers: { Authorization: `Bearer ${bearer}` },
      });
    let response = await fetchChunk(this.readToken());
    if (response.status === 401 && this.refreshToken) {
      const nextToken = await this.refreshToken();
      if (signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      if (nextToken) {
        response = await fetchChunk(nextToken);
      }
    }
    if (response.status === 404 || response.status === 409) return null;
    if (response.status === 401) throw new Error('Operator token required');
    if (!response.ok) throw new Error(`Avatar request failed (${response.status})`);
    return response.arrayBuffer();
  }
  async models(signal: AbortSignal): Promise<ModelInfo[]> { return (await this.request('list', signal)).json(); }
  modelUrl(name: string) { return `${this.base}/api/avatar/vrm/model?name=${encodeURIComponent(name)}`; }
}
