import type { VrmApi } from './vrmApi.js';
import type { VrmDiagnosticSurface } from './vrmDiagnostics.js';
import { VrmLipSync } from './vrmLipSync.js';

export interface ManagedVrmLipSyncOptions {
  api: Pick<VrmApi, 'state' | 'audio'>;
  context: AudioContext;
  surface: VrmDiagnosticSurface;
  retryDelayMs?: number;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

export interface ManagedVrmLipSync {
  pipeline: VrmLipSync;
  dispose: () => void;
}

const INTERACTION_EVENTS = ['click', 'pointerdown', 'keydown'] as const;

export function extractBearerToken(authHeader: string | undefined): string {
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

/**
 * Owns VrmLipSync start, user-gesture AudioContext unlock, and bounded error recovery
 * across mounted 3D surfaces without disturbing an already-running poll loop.
 */
export function startManagedVrmLipSync({
  api,
  context,
  surface,
  retryDelayMs = 1500,
  target = window,
}: ManagedVrmLipSyncOptions): ManagedVrmLipSync {
  let disposed = false;
  let starting = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const clearRetry = () => {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  };

  const runStart = () => {
    if (disposed || starting || pipeline.isRunning()) return;
    starting = true;
    clearRetry();
    void pipeline.start()
      .catch(() => {})
      .finally(() => {
        starting = false;
      });
  };

  const startIfIdle = () => {
    if (disposed || starting || pipeline.isRunning() || context.state !== 'running') return;
    runStart();
  };

  const pipeline = new VrmLipSync(
    api,
    context,
    () => {
      if (disposed || context.state !== 'running') return;
      clearRetry();
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        startIfIdle();
      }, retryDelayMs);
    },
    surface,
  );

  const onStateChange = () => {
    startIfIdle();
  };

  const resumeOnInteraction = () => {
    if (disposed || context.state === 'closed') return;
    if (context.state === 'running') {
      startIfIdle();
      return;
    }
    void context.resume().then(() => {
      startIfIdle();
    }).catch(() => {});
  };

  context.addEventListener?.('statechange', onStateChange);
  for (const eventName of INTERACTION_EVENTS) {
    target.addEventListener(eventName, resumeOnInteraction);
  }
  runStart();

  return {
    pipeline,
    dispose: () => {
      disposed = true;
      clearRetry();
      context.removeEventListener?.('statechange', onStateChange);
      for (const eventName of INTERACTION_EVENTS) {
        target.removeEventListener(eventName, resumeOnInteraction);
      }
      pipeline.dispose();
      if (context.state !== 'closed') {
        void context.close().catch(() => {});
      }
    },
  };
}
