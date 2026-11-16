import { afterEach, expect, it, vi } from 'vitest';
import { VrmLipSync } from './vrmLipSync.js';
import { createVrmDiagnostics } from './vrmDiagnostics.js';

afterEach(() => vi.useRealTimers());
function harness(surface: 'main' | 'desktop-companion' | 'unknown' = 'unknown', diagnostics?: ReturnType<typeof createVrmDiagnostics>) {
  vi.useFakeTimers();
  const sources: any[] = [], gains: any[] = [], analysers: any[] = [];
  let sampleValue = 0.3;
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const context = {
    state: 'running', currentTime: 5, destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 2, sampleRate: 48000 })),
    createBufferSource: () => { const source = { ...node(), start: vi.fn(), stop: vi.fn(), onended: null }; sources.push(source); return source; },
    createAnalyser: () => { const analyser = { ...node(), fftSize: 0, getFloatTimeDomainData: (data: Float32Array) => data.fill(sampleValue) }; analysers.push(analyser); return analyser; },
    createGain: () => { const gain = { ...node(), gain: { value: 1 } }; gains.push(gain); return gain; },
  };
  let sequence = 1, active = true;
  const api = { state: vi.fn(async () => ({ sequence, active, elapsed_ms: 200 })), audio: vi.fn(async () => new ArrayBuffer(4)) };
  const errors = vi.fn();
  const sync = new VrmLipSync(api, context as unknown as AudioContext, errors, surface, diagnostics);
  return { sync, context, sources, gains, analysers, api, errors,
    set: (seq: number, value: boolean) => { sequence = seq; active = value; },
    setEnergy: (value: number) => { sampleValue = value; },
  };
}
it('is silent, offsets decode latency and detects chunks during continuous speech', async () => {
  const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  expect(h.gains[0].gain.value).toBe(0);
  expect(h.sources[0].start).toHaveBeenCalledWith(0, 0.2);
  expect(h.sync.isAudioActive()).toBe(true);
  expect(h.sync.sample()).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(100); expect(h.sources).toHaveLength(1);
  h.set(2, true); await vi.advanceTimersByTimeAsync(100);
  expect(h.sources).toHaveLength(2); expect(h.sources[0].stop).toHaveBeenCalled();
  h.set(2, false); await vi.advanceTimersByTimeAsync(100);
  expect(h.sync.sample()).toBe(0); expect(h.sync.isAudioActive()).toBe(false); expect(h.sources[1].disconnect).toHaveBeenCalled();
  h.sync.dispose();
});
it('does not start a late decode after teardown', async () => {
  const h = harness(); let resolve!: (value: { duration: number; sampleRate: number }) => void;
  h.context.decodeAudioData.mockImplementation(() => new Promise(r => { resolve = r; }));
  await h.sync.start(); await vi.advanceTimersByTimeAsync(0); h.sync.dispose(); resolve({ duration: 2, sampleRate: 48000 });
  await vi.advanceTimersByTimeAsync(0); expect(h.sources).toHaveLength(0);
});
it('resets on source end and refuses stale replay', async () => {
  const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  h.sources[0].onended(); expect(h.sync.sample()).toBe(0); expect(h.sync.isAudioActive()).toBe(false);
  await vi.advanceTimersByTimeAsync(100); expect(h.sources).toHaveLength(1); h.sync.dispose();
});
it('reports true clip activity independently of waveform energy and clears it on source end', async () => {
  const h = harness();
  expect(h.sync.isAudioActive()).toBe(false);
  h.set(1, false);
  await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  expect(h.sync.isAudioActive()).toBe(false);
  h.set(2, true);
  await vi.advanceTimersByTimeAsync(100);
  expect(h.sources[0].start).toHaveBeenCalled();
  h.analysers[0].getFloatTimeDomainData = (data: Float32Array) => data.fill(0);
  expect(h.sync.sample()).toBe(0);
  expect(h.sync.isAudioActive()).toBe(true);
  h.sources[0].onended();
  expect(h.sync.isAudioActive()).toBe(false);
  h.sync.dispose();
  expect(h.sync.isAudioActive()).toBe(false);
});
it('preserves a positive opening for the measured weak RMS signal above the noise floor', async () => {
  const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  h.setEnergy(0.051673);

  const opening = h.sync.sample(undefined, 1 / 60);

  expect(opening).toBeGreaterThan(0);
  expect(opening).toBeLessThan(0.03);
  h.sync.dispose();
});
it('uses elapsed time so 100 ms trough response matches at 30 and 60 fps and quiet settles by 350 ms', async () => {
  async function capture(fps: 30 | 60) {
    const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
    h.setEnergy(1);
    let opening = 0, elapsed = 0;
    while (elapsed < 100) { opening = h.sync.sample(undefined, 1 / fps); elapsed += 1000 / fps; }
    const afterAttack = opening;
    while (elapsed < 500) { opening = h.sync.sample(undefined, 1 / fps); elapsed += 1000 / fps; }

    h.setEnergy(0);
    elapsed = 0;
    while (elapsed < 100) { opening = h.sync.sample(undefined, 1 / fps); elapsed += 1000 / fps; }
    const afterTrough = opening;
    while (elapsed < 350) { opening = h.sync.sample(undefined, 1 / fps); elapsed += 1000 / fps; }
    h.sync.dispose();
    return { afterAttack, afterTrough, afterQuiet: opening };
  }

  const at30 = await capture(30);
  const at60 = await capture(60);

  expect(at30.afterTrough).toBeGreaterThan(0);
  expect(at60.afterTrough).toBeGreaterThan(0);
  expect(at30.afterAttack).toBeCloseTo(at60.afterAttack, 3);
  expect(at30.afterTrough).toBeCloseTo(at60.afterTrough, 3);
  expect(at30.afterQuiet).toBe(0);
  expect(at60.afterQuiet).toBe(0);
});
it('records resume rejection metadata without changing the original failure or starting API polling', async () => {
  const diagnostics = createVrmDiagnostics(); diagnostics.start('edge');
  const h = harness('desktop-companion', diagnostics);
  const failure = new Error('Audio permission denied');
  h.context.resume.mockRejectedValueOnce(failure);

  await expect(h.sync.start()).rejects.toBe(failure);
  expect(diagnostics.read()).toEqual([expect.objectContaining({
    kind: 'source', surface: 'desktop-companion', providerTag: 'edge', reason: 'resume_error', active: false,
  })]);
  expect(h.api.state).not.toHaveBeenCalled();
  expect(h.api.audio).not.toHaveBeenCalled();
});
it('keeps failed resume unchanged and clock-free while diagnostics are disabled', async () => {
  const monotonicNow = vi.fn(() => 1), wallNow = vi.fn(() => 2);
  const diagnostics = createVrmDiagnostics({ monotonicNow, wallNow });
  const h = harness('main', diagnostics);
  const failure = new Error('Audio permission denied');
  h.context.resume.mockRejectedValueOnce(failure);

  await expect(h.sync.start()).rejects.toBe(failure);
  expect(diagnostics.read()).toEqual([]);
  expect(monotonicNow).not.toHaveBeenCalled();
  expect(wallNow).not.toHaveBeenCalled();
  expect(h.api.state).not.toHaveBeenCalled();
  expect(h.api.audio).not.toHaveBeenCalled();
});
it('records a suspended context when resume resolves without reaching running state', async () => {
  const diagnostics = createVrmDiagnostics(); diagnostics.start();
  const h = harness('main', diagnostics);
  h.context.resume.mockImplementationOnce(async () => { h.context.state = 'suspended'; });

  await expect(h.sync.start()).rejects.toThrow('Use Interact to enable audio analysis');
  expect(diagnostics.read()).toEqual([expect.objectContaining({
    kind: 'source', surface: 'main', reason: 'context_suspended', active: false,
  })]);
  expect(h.api.state).not.toHaveBeenCalled();
  expect(h.api.audio).not.toHaveBeenCalled();
});
it('watchdog closes mouth on a hung request', async () => {
  const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  h.api.state.mockImplementation(() => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(1700); expect(h.sync.sample()).toBe(0); h.sync.dispose();
});
it('tolerates transient 404/409 or AbortError without reporting a fatal error', async () => {
  const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  h.set(2, true);
  h.api.audio.mockRejectedValueOnce(new Error('Avatar request failed (404)'));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.errors).not.toHaveBeenCalled();
  expect(h.sync.sample()).toBe(0);

  const abortError = new DOMException('The operation was aborted', 'AbortError');
  h.set(3, true);
  h.api.audio.mockRejectedValueOnce(abortError);
  await vi.advanceTimersByTimeAsync(100);
  expect(h.errors).not.toHaveBeenCalled();

  h.set(4, true);
  h.api.audio.mockRejectedValueOnce(new Error('Operator token required'));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.errors).toHaveBeenCalledWith('Operator token required');
  h.sync.dispose();
});
it('retries fetching sequence on next poll if initial audio fetch returned null', async () => {
  const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  h.set(2, true);
  h.api.audio.mockResolvedValueOnce(null as unknown as ArrayBuffer);
  await vi.advanceTimersByTimeAsync(100);
  expect(h.sources).toHaveLength(1);

  h.api.audio.mockResolvedValueOnce(new ArrayBuffer(4));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.sources).toHaveLength(2);
  h.sync.dispose();
});
it('halts polling loop on fatal error', async () => {
  const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  h.api.state.mockRejectedValueOnce(new Error('Operator token required'));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.errors).toHaveBeenCalledWith('Operator token required');
  const callCount = h.api.state.mock.calls.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(h.api.state.mock.calls.length).toBe(callCount);
  h.sync.dispose();
});
it('degrades to idle without fatal error when audio decoding fails on corrupt chunk', async () => {
  const h = harness(); await h.sync.start(); await vi.advanceTimersByTimeAsync(0);
  h.set(2, true);
  h.context.decodeAudioData.mockRejectedValueOnce(new Error('Corrupt audio chunk'));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.errors).not.toHaveBeenCalled();
  expect(h.sync.sample()).toBe(0);
  h.sync.dispose();
});
it('recovers and starts analysis if second state check aborts during sequence processing', async () => {
  const h = harness();
  let stateCall = 0;
  h.api.state.mockImplementation(async () => {
    stateCall++;
    if (stateCall === 2) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    return { sequence: 1, active: true, elapsed_ms: 200 };
  });

  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sources).toHaveLength(0);
  expect(h.errors).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(100);
  expect(h.sources).toHaveLength(1);
  expect(h.sources[0].start).toHaveBeenCalled();
  expect(h.sync.sample()).toBeGreaterThan(0);
  expect(h.errors).not.toHaveBeenCalled();
  h.sync.dispose();
});
it('recovers from transient 404/abort on same chunk without duplicate sources or errors', async () => {
  const h = harness();
  h.api.audio.mockResolvedValueOnce(null as unknown as ArrayBuffer);
  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sources).toHaveLength(0);
  expect(h.errors).not.toHaveBeenCalled();

  h.api.audio.mockResolvedValueOnce(new ArrayBuffer(4));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.sources).toHaveLength(1);
  expect(h.sources[0].start).toHaveBeenCalled();
  expect(h.sync.sample()).toBeGreaterThan(0);
  expect(h.errors).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(100);
  expect(h.sources).toHaveLength(1);
  expect(h.errors).not.toHaveBeenCalled();
  h.sync.dispose();
});
it('discards corrupt chunk once without infinite retry, then analyzes next valid chunk', async () => {
  const h = harness();
  h.context.decodeAudioData.mockRejectedValueOnce(new Error('Corrupt audio chunk'));
  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sources).toHaveLength(0);
  expect(h.errors).not.toHaveBeenCalled();

  const audioCallsBefore = h.api.audio.mock.calls.length;
  await vi.advanceTimersByTimeAsync(100);
  expect(h.api.audio.mock.calls.length).toBe(audioCallsBefore);
  expect(h.sources).toHaveLength(0);

  h.set(2, true);
  h.api.audio.mockResolvedValueOnce(new ArrayBuffer(4));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.sources).toHaveLength(1);
  expect(h.sources[0].start).toHaveBeenCalled();
  expect(h.sync.sample()).toBeGreaterThan(0);
  expect(h.errors).not.toHaveBeenCalled();
  h.sync.dispose();
});
it('late cancellation during pending fetch or decode does not start source or reopen mouth', async () => {
  const h = harness();
  let resolveAudio!: (value: ArrayBuffer) => void;
  h.api.audio.mockImplementation(() => new Promise(r => { resolveAudio = r; }));

  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);
  h.sync.dispose();

  resolveAudio(new ArrayBuffer(4));
  await vi.advanceTimersByTimeAsync(100);

  expect(h.sources).toHaveLength(0);
  expect(h.sync.sample()).toBe(0);
  expect(h.errors).not.toHaveBeenCalled();
});
it('watchdog from old generation does not clear source or abort new generation on rapid restart', async () => {
  const h = harness();
  h.api.state.mockImplementationOnce(() => new Promise(() => {}));
  await h.sync.start();
  await vi.advanceTimersByTimeAsync(100);

  h.api.state.mockResolvedValue({ sequence: 2, active: true, elapsed_ms: 200 });
  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);

  expect(h.sources).toHaveLength(1);
  expect(h.sources[0].start).toHaveBeenCalled();
  expect(h.sync.sample()).toBeGreaterThan(0);

  await vi.advanceTimersByTimeAsync(1600);

  expect(h.sources[0].stop).not.toHaveBeenCalled();
  expect(h.sync.sample()).toBeGreaterThan(0);
  h.sync.dispose();
});
it('decode error from obsolete generation does not clear source or mutate sequence of active generation', async () => {
  const h = harness();
  let rejectOldDecode!: (reason: unknown) => void;
  h.context.decodeAudioData.mockImplementationOnce(() => new Promise((_, reject) => {
    rejectOldDecode = reject;
  }));

  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sources).toHaveLength(0);

  h.set(2, true);
  h.context.decodeAudioData.mockResolvedValueOnce({ duration: 2, sampleRate: 48000 });
  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);

  expect(h.sources).toHaveLength(1);
  expect(h.sources[0].start).toHaveBeenCalled();
  expect(h.sync.sample()).toBeGreaterThan(0);

  rejectOldDecode(new Error('Old decode failure'));
  await vi.advanceTimersByTimeAsync(0);

  expect(h.sources[0].stop).not.toHaveBeenCalled();
  expect(h.sync.sample()).toBeGreaterThan(0);
  expect(h.errors).not.toHaveBeenCalled();
  h.sync.dispose();
});

it('captures RMS, decoder/source timing and reset reason without changing the audio path', async () => {
  const diagnostics = createVrmDiagnostics({ monotonicNow: () => 50, wallNow: () => 1000 });
  diagnostics.start('edge');
  const h = harness('desktop-companion', diagnostics);
  await h.sync.start(); await vi.advanceTimersByTimeAsync(0);

  expect(h.sources[0].start).toHaveBeenCalledWith(0, 0.2);
  expect(h.gains[0].gain.value).toBe(0);
  expect(h.sync.isAudioActive()).toBe(true);
  expect(h.sync.sample(1)).toBeCloseTo(0.4);
  expect(diagnostics.read()).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'source', surface: 'desktop-companion', providerTag: 'edge', reason: 'sequence_change', sequence: 1 }),
    expect.objectContaining({ kind: 'source', surface: 'desktop-companion', providerTag: 'edge', reason: 'source_started', sequence: 1, elapsedMs: 200, contextTime: 5, decodeMs: 0, bufferDuration: 2, sampleRate: 48000, sourceOffset: 0.2 }),
    expect.objectContaining({ kind: 'sample', surface: 'desktop-companion', providerTag: 'edge', frameId: 1, sequence: 1, available: true, rms: expect.closeTo(0.3, 5), target: 1, opening: 0.4 }),
  ]));

  h.sources[0].onended();
  expect(h.sync.sample(2)).toBe(0);
  expect(diagnostics.read()).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'source', reason: 'natural_end', sequence: 1 }),
  ]));
  h.sync.dispose();
});

it('does not abort slow VM audio fetch and CPU decode exceeding 1500ms combined', async () => {
  const h = harness();
  let stateCall = 0;
  h.api.state.mockImplementation(() => new Promise(resolve => {
    stateCall++;
    setTimeout(() => {
      resolve({ sequence: 1, active: true, elapsed_ms: stateCall === 1 ? 200 : 1900 });
    }, stateCall === 1 ? 200 : 100);
  }));
  h.api.audio.mockImplementation(() => new Promise(resolve => {
    setTimeout(() => resolve(new ArrayBuffer(4)), 400);
  }));
  h.context.decodeAudioData.mockImplementation(() => new Promise(resolve => {
    setTimeout(() => resolve({ duration: 4, sampleRate: 48000 }), 1300);
  }));

  await h.sync.start();
  await vi.advanceTimersByTimeAsync(2100);

  expect(h.errors).not.toHaveBeenCalled();
  expect(h.sources).toHaveLength(1);
  expect(h.sources[0].start).toHaveBeenCalledWith(0, 1.9);
  expect(h.sync.isAudioActive()).toBe(true);
  expect(h.sync.sample()).toBeGreaterThan(0);
  h.sync.dispose();
});

it('tolerates transient 503 backend busy errors without halting polling', async () => {
  const h = harness();
  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);

  h.set(2, true);
  h.api.audio.mockRejectedValueOnce(new Error('Avatar request failed (503)'));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.errors).not.toHaveBeenCalled();
  expect(h.sync.isRunning()).toBe(true);

  h.api.audio.mockResolvedValueOnce(new ArrayBuffer(4));
  await vi.advanceTimersByTimeAsync(100);
  expect(h.sources).toHaveLength(2);
  expect(h.sync.isAudioActive()).toBe(true);
  expect(h.sync.sample()).toBeGreaterThan(0);
  h.sync.dispose();
});

it('refuses to start source if AudioContext suspends during audio decode', async () => {
  const h = harness();
  h.context.decodeAudioData.mockImplementationOnce(async () => {
    h.context.state = 'suspended';
    return { duration: 2, sampleRate: 48000 };
  });

  await h.sync.start();
  await vi.advanceTimersByTimeAsync(0);

  expect(h.sources).toHaveLength(0);
  expect(h.sync.isAudioActive()).toBe(false);
  expect(h.sync.sample()).toBe(0);
  h.sync.dispose();
});




