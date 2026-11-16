import { expect, it, vi } from 'vitest';
import { createVrmDiagnostics } from './vrmDiagnostics.js';

it('does not read either clock or retain records until capture is explicitly started', () => {
  const monotonicNow = vi.fn(() => 10);
  const wallNow = vi.fn(() => 20);
  const diagnostics = createVrmDiagnostics({ capacity: 4, monotonicNow, wallNow });

  diagnostics.recordSample('main', 1, 7, true, 0.25, 0.84, 0.3);
  diagnostics.recordSource('main', 'natural_end', 7, false, 500, 1.5, null, 2, 48000, null);

  expect(diagnostics.isRecording()).toBe(false);
  expect(diagnostics.read()).toEqual([]);
  expect(monotonicNow).not.toHaveBeenCalled();
  expect(wallNow).not.toHaveBeenCalled();
});

it('records only allowlisted finite metadata and rejects arbitrary labels and provider tags', () => {
  const diagnostics = createVrmDiagnostics({ monotonicNow: () => 12.5, wallNow: () => 30 });
  diagnostics.start('edge');
  diagnostics.recordSample('untrusted/path' as never, 1, 7, true, 0.25, 0.84, 0.3);
  diagnostics.recordSource('desktop-companion', 'natural_end', 7, false, Number.NaN, 1.5, null, 2, 48000, null);
  diagnostics.start('raw user text' as never);
  diagnostics.recordFrame('main', 2, 0.3, true, 'unknown state' as never, 0.3, 0.3, 0.3, 0.06, 'unknown gate' as never);

  const records = diagnostics.read();
  expect(records).toEqual([
    expect.objectContaining({ kind: 'sample', surface: 'unknown', providerTag: 'edge', sequence: 7, rms: 0.25 }),
    expect.objectContaining({ kind: 'source', surface: 'desktop-companion', providerTag: 'edge', reason: 'natural_end', elapsedMs: null }),
    expect.objectContaining({ kind: 'frame', surface: 'main', providerTag: 'unknown', state: 'unknown', gateReason: 'unknown' }),
  ]);
  expect(JSON.stringify(records)).not.toContain('raw user text');
  expect(JSON.stringify(records)).not.toContain('untrusted/path');
});

it('keeps a bounded FIFO snapshot and returns copies that cannot mutate the ring', () => {
  let now = 0;
  const diagnostics = createVrmDiagnostics({ capacity: 2, monotonicNow: () => ++now, wallNow: () => now });
  diagnostics.start('piper');
  diagnostics.recordSample('main', 1, 1, true, 0.1, 0.24, 0.1);
  diagnostics.recordSample('main', 2, 1, true, 0.2, 0.64, 0.3);
  diagnostics.recordSample('main', 3, 1, true, 0.3, 1, 0.7);

  const firstRead = diagnostics.read();
  expect(firstRead).toHaveLength(2);
  expect(firstRead.map(record => record.kind === 'sample' ? record.frameId : null)).toEqual([2, 3]);
  (firstRead[0] as { rms: number }).rms = 99;
  expect(diagnostics.read()[0]).toMatchObject({ kind: 'sample', rms: 0.2 });

  diagnostics.stop();
  diagnostics.clear();
  expect(diagnostics.isRecording()).toBe(false);
  expect(diagnostics.read()).toEqual([]);
});

it('contains diagnostic clock failures instead of throwing into an audio or animation caller', () => {
  const diagnostics = createVrmDiagnostics({
    monotonicNow: () => { throw new Error('private error must not be recorded'); },
    wallNow: () => { throw new Error('private error must not be recorded'); },
  });
  diagnostics.start();

  expect(() => diagnostics.recordFrame('main', 1, 0.5, true, 'speaking', 0.5, 0.5, 0.5, 0.1, 'open')).not.toThrow();
  expect(diagnostics.read()).toEqual([]);
});
