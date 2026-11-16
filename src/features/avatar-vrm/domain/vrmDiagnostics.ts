export type VrmDiagnosticSurface = 'main' | 'desktop-companion' | 'unknown';
export type VrmProviderTag = 'edge' | 'piper' | 'unknown';
export type VrmSourceReason =
  | 'sequence_change' | 'inactive' | 'natural_end' | 'watchdog' | 'empty_audio'
  | 'decode_error' | 'source_started' | 'source_offset_exhausted'
  | 'transient_api_error' | 'request_error' | 'request_abort' | 'resume_error' | 'context_suspended' | 'dispose';
export type VrmAvatarState = 'idle' | 'speaking' | 'speaking_alt' | 'thinking' | 'listening' | 'processing' | 'sleeping' | 'error' | 'unknown';
export type VrmMouthGate = 'open' | 'sleeping' | 'audio_inactive' | 'deadband' | 'unknown';

export type VrmDiagnosticRecord =
  | {
      kind: 'sample'; surface: VrmDiagnosticSurface; providerTag: VrmProviderTag;
      monotonicMs: number; wallTimeMs: number; frameId: number | null; sequence: number | null;
      available: boolean; rms: number | null; target: number | null; opening: number;
    }
  | {
      kind: 'source'; surface: VrmDiagnosticSurface; providerTag: VrmProviderTag;
      monotonicMs: number; wallTimeMs: number; reason: VrmSourceReason; sequence: number | null;
      active: boolean; elapsedMs: number | null; contextTime: number | null; decodeMs: number | null;
      bufferDuration: number | null; sampleRate: number | null; sourceOffset: number | null;
    }
  | {
      kind: 'frame'; surface: VrmDiagnosticSurface; providerTag: VrmProviderTag;
      monotonicMs: number; wallTimeMs: number; frameId: number; inputMouth: number;
      audioActive: boolean; state: VrmAvatarState; activeMouth: number; mouthOpen: number;
      aa: number; oh: number; gateReason: VrmMouthGate;
    };

type PendingVrmDiagnosticRecord = VrmDiagnosticRecord extends infer Record
  ? Record extends VrmDiagnosticRecord
    ? Omit<Record, 'monotonicMs' | 'wallTimeMs' | 'providerTag'>
    : never
  : never;

export interface VrmDiagnosticsConsole {
  /** Optional provider tag is operator-supplied; it is not verified by the app. */
  start(providerTag?: VrmProviderTag): void;
  stop(): void;
  read(): VrmDiagnosticRecord[];
  clear(): void;
}

export interface VrmDiagnosticsController extends VrmDiagnosticsConsole {
  isRecording(): boolean;
  mark(): number | null;
  recordSample(surface: unknown, frameId: unknown, sequence: unknown, available: unknown, energy: unknown, target: unknown, opening: unknown): void;
  recordSource(surface: unknown, reason: unknown, sequence: unknown, active: unknown, elapsedMs: unknown, contextTime: unknown, decodeMs: unknown, bufferDuration: unknown, sampleRate: unknown, sourceOffset: unknown): void;
  recordFrame(surface: unknown, frameId: unknown, inputMouth: unknown, audioActive: unknown, state: unknown, activeMouth: unknown, mouthOpen: unknown, aa: unknown, oh: unknown, gateReason: unknown): void;
}

const DEFAULT_CAPACITY = 4096;
const SURFACES = new Set<VrmDiagnosticSurface>(['main', 'desktop-companion', 'unknown']);
const PROVIDERS = new Set<VrmProviderTag>(['edge', 'piper', 'unknown']);
const SOURCE_REASONS = new Set<VrmSourceReason>([
  'sequence_change', 'inactive', 'natural_end', 'watchdog', 'empty_audio', 'decode_error',
  'source_started', 'source_offset_exhausted', 'transient_api_error', 'request_error',
  'request_abort', 'resume_error', 'context_suspended', 'dispose',
]);
const AVATAR_STATES = new Set<VrmAvatarState>([
  'idle', 'speaking', 'speaking_alt', 'thinking', 'listening', 'processing', 'sleeping', 'error', 'unknown',
]);
const MOUTH_GATES = new Set<VrmMouthGate>(['open', 'sleeping', 'audio_inactive', 'deadband', 'unknown']);

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  const number = finite(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function choice<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback;
}

export function createVrmDiagnostics(options: {
  capacity?: number; monotonicNow?: () => number; wallNow?: () => number;
} = {}): VrmDiagnosticsController {
  const capacity = Number.isSafeInteger(options.capacity) && (options.capacity ?? 0) > 0
    ? options.capacity!
    : DEFAULT_CAPACITY;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const wallNow = options.wallNow ?? (() => Date.now());
  let ring: Array<VrmDiagnosticRecord | undefined> | undefined;
  let next = 0;
  let count = 0;
  let recording = false;
  let providerTag: VrmProviderTag = 'unknown';

  function append(record: PendingVrmDiagnosticRecord): void {
    if (!recording) return;
    try {
      const monotonicMs = finite(monotonicNow());
      const wallTimeMs = finite(wallNow());
      if (monotonicMs === null || wallTimeMs === null) return;
      ring ??= new Array<VrmDiagnosticRecord | undefined>(capacity);
      const complete = { ...record, providerTag, monotonicMs, wallTimeMs } as VrmDiagnosticRecord;
      ring[next] = complete;
      next = (next + 1) % capacity;
      count = Math.min(count + 1, capacity);
    } catch {
      // Diagnostics are strictly observational and cannot escape into callers.
    }
  }

  return {
    start(tag = 'unknown') {
      providerTag = choice(tag, PROVIDERS, 'unknown');
      recording = true;
    },
    stop() { recording = false; },
    clear() { ring = undefined; next = 0; count = 0; },
    isRecording() { return recording; },
    mark() {
      if (!recording) return null;
      try { return finite(monotonicNow()); } catch { return null; }
    },
    read() {
      if (!ring || count === 0) return [];
      try {
        const start = (next - count + capacity) % capacity;
        const result: VrmDiagnosticRecord[] = [];
        for (let offset = 0; offset < count; offset++) {
          const record = ring[(start + offset) % capacity];
          if (record) result.push({ ...record } as VrmDiagnosticRecord);
        }
        return result;
      } catch {
        return [];
      }
    },
    recordSample(surface, frameId, sequence, available, energy, target, opening) {
      if (!recording) return;
      try {
        append({
          kind: 'sample', surface: choice(surface, SURFACES, 'unknown'),
          frameId: integer(frameId), sequence: integer(sequence), available: available === true,
          rms: finite(energy), target: finite(target), opening: finite(opening) ?? 0,
        });
      } catch { /* Never affect the audio sample result. */ }
    },
    recordSource(surface, reason, sequence, active, elapsedMs, contextTime, decodeMs, bufferDuration, sampleRate, sourceOffset) {
      if (!recording) return;
      try {
        append({
          kind: 'source', surface: choice(surface, SURFACES, 'unknown'),
          reason: choice(reason, SOURCE_REASONS, 'request_error'), sequence: integer(sequence), active: active === true,
          elapsedMs: finite(elapsedMs), contextTime: finite(contextTime), decodeMs: finite(decodeMs),
          bufferDuration: finite(bufferDuration), sampleRate: finite(sampleRate), sourceOffset: finite(sourceOffset),
        });
      } catch { /* Never affect source lifecycle. */ }
    },
    recordFrame(surface, frameId, inputMouth, audioActive, state, activeMouth, mouthOpen, aa, oh, gateReason) {
      if (!recording) return;
      try {
        const safeFrameId = integer(frameId);
        if (safeFrameId === null) return;
        append({
          kind: 'frame', surface: choice(surface, SURFACES, 'unknown'), frameId: safeFrameId,
          inputMouth: finite(inputMouth) ?? 0, audioActive: audioActive === true,
          state: choice(state, AVATAR_STATES, 'unknown'), activeMouth: finite(activeMouth) ?? 0,
          mouthOpen: finite(mouthOpen) ?? 0, aa: finite(aa) ?? 0, oh: finite(oh) ?? 0,
          gateReason: choice(gateReason, MOUTH_GATES, 'unknown'),
        });
      } catch { /* Never affect animation output. */ }
    },
  };
}

export const vrmDiagnostics = createVrmDiagnostics();

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const consoleApi: VrmDiagnosticsConsole = {
    start: (providerTag) => vrmDiagnostics.start(providerTag),
    stop: () => vrmDiagnostics.stop(),
    read: () => vrmDiagnostics.read(),
    clear: () => vrmDiagnostics.clear(),
  };
  try { Object.defineProperty(window, '__vrmDiagnostics', { configurable: true, value: consoleApi }); }
  catch { /* A tooling collision must never prevent the avatar app from loading. */ }
}

declare global {
  interface Window {
    __vrmDiagnostics?: VrmDiagnosticsConsole;
  }
}
