import { afterEach, describe, expect, it, vi } from 'vitest';
import { VrmApi } from './vrmApi.js';
import { extractBearerToken, startManagedVrmLipSync } from './vrmLipSyncLifecycle.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createContextFixture(initialState: AudioContextState = 'running') {
  const listeners = new Map<string, Set<() => void>>();
  const sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  let allowUnlock = initialState === 'running';
  const context = {
    state: initialState,
    currentTime: 0,
    destination: {},
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    }),
    removeEventListener: vi.fn((event: string, cb: () => void) => {
      listeners.get(event)?.delete(cb);
    }),
    resume: vi.fn(async () => {
      if (allowUnlock) {
        context.state = 'running';
        listeners.get('statechange')?.forEach(cb => cb());
      }
    }),
    close: vi.fn(async () => {
      context.state = 'closed';
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 2, sampleRate: 48000 })),
    createBufferSource: () => {
      const source = { ...node(), buffer: null, start: vi.fn(), stop: vi.fn(), onended: null };
      sources.push(source);
      return source;
    },
    createAnalyser: () => ({ ...node(), fftSize: 0, getFloatTimeDomainData: (data: Float32Array) => data.fill(0.3) }),
    createGain: () => ({ ...node(), gain: { value: 1 } }),
  };
  return {
    context,
    sources,
    setUnlockable: (value: boolean) => { allowUnlock = value; },
    emitState: (next: AudioContextState) => {
      context.state = next;
      listeners.get('statechange')?.forEach(cb => cb());
    },
  };
}

describe('extractBearerToken and VrmApi dynamic token refresh', () => {
  it('extracts bearer tokens safely', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('Basic abc123')).toBe('');
    expect(extractBearerToken(undefined)).toBe('');
  });

  it('refreshes operator token once on 401 before failing', async () => {
    let token = '';
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (auth === 'Bearer fresh-token') {
        return new Response(new ArrayBuffer(4), { status: 200 });
      }
      return new Response(null, { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn(async () => {
      token = 'fresh-token';
      return token;
    });

    const api = new VrmApi('http://127.0.0.1:8765', () => token, refresh);
    const bytes = await api.audio(1, new AbortController().signal);
    expect(bytes?.byteLength).toBe(4);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws Operator token required when refresh returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const refresh = vi.fn(async () => null);
    const api = new VrmApi('http://127.0.0.1:8765', () => '', refresh);

    await expect(api.audio(1, new AbortController().signal)).rejects.toThrow('Operator token required');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('startManagedVrmLipSync', () => {
  it('does not restart an already-running pipeline when the user clicks or types', async () => {
    vi.useFakeTimers();
    const target = new EventTarget() as unknown as Window;
    const fx = createContextFixture('running');
    const api = {
      state: vi.fn(async () => ({ sequence: 1, active: true, elapsed_ms: 100 })),
      audio: vi.fn(async () => new ArrayBuffer(4)),
    };

    const managed = startManagedVrmLipSync({
      api,
      context: fx.context as unknown as AudioContext,
      surface: 'main',
      target,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(managed.pipeline.isAudioActive()).toBe(true);
    expect(fx.sources).toHaveLength(1);
    const resumeCountAfterBoot = fx.context.resume.mock.calls.length;

    (target as unknown as EventTarget).dispatchEvent(new Event('click'));
    (target as unknown as EventTarget).dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(0);

    expect(fx.context.resume.mock.calls.length).toBe(resumeCountAfterBoot);
    expect(fx.sources[0].stop).not.toHaveBeenCalled();
    managed.dispose();
  });

  it('recovers from transient startup error via retry and cleans up listeners on dispose', async () => {
    vi.useFakeTimers();
    const target = new EventTarget() as unknown as Window;
    const fx = createContextFixture('running');
    const api = {
      state: vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValue({ sequence: 1, active: true, elapsed_ms: 100 }),
      audio: vi.fn(async () => new ArrayBuffer(4)),
    };

    const managed = startManagedVrmLipSync({
      api,
      context: fx.context as unknown as AudioContext,
      surface: 'desktop-companion',
      retryDelayMs: 500,
      target,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(managed.pipeline.isRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    expect(managed.pipeline.isRunning()).toBe(true);
    expect(managed.pipeline.isAudioActive()).toBe(true);

    managed.dispose();
    expect(fx.context.removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function));
  });

  it('recovers automatically when AudioContext suspends mid-session and later returns to running', async () => {
    vi.useFakeTimers();
    const target = new EventTarget() as unknown as Window;
    const fx = createContextFixture('running');
    const api = {
      state: vi.fn(async () => ({ sequence: 1, active: true, elapsed_ms: 100 })),
      audio: vi.fn(async () => new ArrayBuffer(4)),
    };

    const managed = startManagedVrmLipSync({
      api,
      context: fx.context as unknown as AudioContext,
      surface: 'main',
      target,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(managed.pipeline.isAudioActive()).toBe(true);

    fx.emitState('suspended');
    await vi.advanceTimersByTimeAsync(100);
    expect(managed.pipeline.isRunning()).toBe(false);
    expect(managed.pipeline.isAudioActive()).toBe(false);

    fx.emitState('running');
    await vi.advanceTimersByTimeAsync(0);
    expect(managed.pipeline.isRunning()).toBe(true);
    expect(managed.pipeline.isAudioActive()).toBe(true);
    managed.dispose();
  });
});
