import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";
import { emitAppEvent } from "../lib/appEvents.js";
import { useAvatarLiveState } from "../store/avatarLiveStore.js";

/**
 * Push-to-Talk endpoints (opencohost/api/main.py ~1794-1828, WU2) are brand
 * new — no OpenAPI snapshot includes them yet, so this module is hand-typed
 * end to end from opencohost/api/models.py::Ptt*Response, the same
 * self-contained pattern as src/api/music.ts (types + fetchers + hooks in
 * one file, only the shared ApiError/authFetch/getApiBaseUrl primitives
 * imported from client.ts).
 *
 * PRIVACY (hard rule 2): none of these shapes ever carries transcript text —
 * the operator's dictation travels WhisperLive WS -> PttSession buffer (RAM)
 * -> process_context and NEVER crosses HTTP. `buffered_chars` is an int
 * count only; `state`/`last_error` are fixed lifecycle literals. This client
 * literally cannot receive the transcript, so it cannot leak it.
 * ponytail: keep in sync manually until the snapshot is regenerated.
 */
export type PttLifecycleState = "idle" | "listening" | "flushing";

export interface PttStartResponse {
  session_id: string;
  state: PttLifecycleState;
}

export interface PttKeepaliveResponse {
  session_id: string;
  state: PttLifecycleState;
  buffered_chars: number;
}

export interface PttStopResponse {
  state: PttLifecycleState;
}

export interface PttStateResponse {
  state: PttLifecycleState;
  session_id: string | null;
  buffered_chars: number;
  last_error: string | null;
  /** LiveAudio (WhisperLive) connection URL currently configured on the
   * server (liveaudio_url_config track). Read-only here — change it via
   * PUT /api/ptt/config below. Optional: older backends omit the field. */
  stt_ws_url?: string | null;
}

/** PUT /api/ptt/config body/response (liveaudio_url_config track). Field is
 * spelled `stt_ws_uri` here (write side) vs. `stt_ws_url` on GET /api/ptt/state
 * (read side) — that mismatch is the pinned backend contract, not a typo. */
export interface PttConfigResponse {
  stt_ws_uri: string;
}

export interface PttTestResponse {
  ok: boolean;
  detail: string;
}

async function pttErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body.detail ?? fallback;
  } catch {
    // non-JSON error body — fall back to a generic message instead of
    // letting res.json() throw an opaque SyntaxError.
    return fallback;
  }
}

/**
 * POST /api/ptt/start. 409 session_active / 503 stt_unreachable are real
 * outcomes the hold gesture must render honestly (never a fake "listening"),
 * so both surface as a typed ApiError instead of being swallowed here.
 */
export async function postPttStart(): Promise<PttStartResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/ptt/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  if (!res.ok) {
    throw new ApiError(await pttErrorDetail(res, `POST /api/ptt/start failed with ${res.status}`), res.status);
  }
  return (await res.json()) as PttStartResponse;
}

/**
 * POST /api/ptt/keepalive — the ~1Hz proof-of-life the server watchdog
 * watches for. A 409 means the server already guillotined this session
 * (missed 3 beats); the caller reads that as "drop to idle".
 */
export async function postPttKeepalive(sessionId: string): Promise<PttKeepaliveResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/ptt/keepalive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId })
  });
  if (!res.ok) {
    throw new ApiError(await pttErrorDetail(res, `POST /api/ptt/keepalive failed with ${res.status}`), res.status);
  }
  return (await res.json()) as PttKeepaliveResponse;
}

/**
 * POST /api/ptt/stop — ALWAYS 200, fully idempotent (backend contract): an
 * unknown/absent session still returns state:"idle". `sessionId` omitted
 * stops "whatever is active", used by the unmount/blur safety net when the
 * hook hasn't captured a session id yet (start() still in flight).
 */
export async function postPttStop(sessionId?: string): Promise<PttStopResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/ptt/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionId ? { session_id: sessionId } : {})
  });
  if (!res.ok) {
    throw new ApiError(await pttErrorDetail(res, `POST /api/ptt/stop failed with ${res.status}`), res.status);
  }
  return (await res.json()) as PttStopResponse;
}

/**
 * GET /api/ptt/state — open per auth rule 3 (non-mutating read). Polled only
 * while flushing (see usePttHold below); buffered_chars is a count, NEVER
 * the text.
 */
export async function getPttState(): Promise<PttStateResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/ptt/state`);
  if (!res.ok) {
    throw new ApiError(`GET /api/ptt/state failed with ${res.status}`, res.status);
  }
  return (await res.json()) as PttStateResponse;
}

/**
 * PUT /api/ptt/config — sets the LiveAudio (WhisperLive) connection URL.
 * 422 (bad scheme: server only accepts ws:// or wss://) carries a specific
 * reason and must render honestly, never a generic failure.
 */
export async function putPttConfig(sttWsUri: string): Promise<PttConfigResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/ptt/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stt_ws_uri: sttWsUri })
  });
  if (res.status === 422) {
    throw new ValidationError(await pttErrorDetail(res, "invalid stt_ws_uri"));
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/ptt/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as PttConfigResponse;
}

/**
 * POST /api/ptt/test — probes LiveAudio reachability. `sttWsUri` omitted
 * tests the currently saved URL. ALWAYS 200: a failed probe is `ok:false`
 * with a `detail` reason, never an HTTP error — do not treat it as a
 * mutation failure.
 */
export async function postPttTest(sttWsUri?: string): Promise<PttTestResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/ptt/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sttWsUri ? { stt_ws_uri: sttWsUri } : {})
  });
  if (!res.ok) {
    throw new ApiError(`POST /api/ptt/test failed with ${res.status}`, res.status);
  }
  return (await res.json()) as PttTestResponse;
}

export const PTT_STATE_QUERY_KEY = ["ptt-state"] as const;

/** Read-only current LiveAudio config (and lifecycle state) — powers the
 * "URL activa" readout in PTTCard. One-shot fetch, no polling: the
 * save mutation below patches this same cache entry on success instead. */
export function usePttStateQuery() {
  return useQuery({ queryKey: PTT_STATE_QUERY_KEY, queryFn: getPttState });
}

export function useUpdatePttConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putPttConfig,
    onSuccess: (data) => {
      // Field-name mismatch is the pinned contract (uri here, url on GET) —
      // map explicitly rather than spreading the response into the cache.
      queryClient.setQueryData<PttStateResponse>(PTT_STATE_QUERY_KEY, (old) =>
        old ? { ...old, stt_ws_url: data.stt_ws_uri } : old
      );
    }
  });
}

export function useTestPttConnectionMutation() {
  return useMutation({ mutationFn: postPttTest });
}

/** Cadence of the app-wide PTT presence poll below — same 1Hz as the keepalive
 * and as useLiveTranscript, which shares this exact query entry. */
const PTT_SIGNAL_POLL_MS = 1000;

/**
 * App-wide "is a PTT hold open" signal, mirrored into `avatarLiveStore` so the
 * avatar can show "escuchando". Mount ONCE (EventBridge); it returns nothing.
 *
 * This is the ONLY signal that sees the EXTERNAL F10 bridge: that hotkey posts
 * /api/ptt/start from outside the webview, so no `usePttHold` instance ever
 * learns the session exists. `usePttHold` publishes the same flag on its own
 * transitions for instant in-app feedback — both describe the same single-slot
 * server session, so they cannot disagree, they only differ in latency.
 *
 * Deliberately NOT merged with usePttHold's flush poll: that one must only ever
 * observe state fetched AFTER its own release, or a cached "idle" from before
 * the hold would converge it to idle the instant it starts flushing.
 */
export function usePttServerSignal(): void {
  const query = useQuery({
    queryKey: PTT_STATE_QUERY_KEY,
    queryFn: getPttState,
    refetchInterval: PTT_SIGNAL_POLL_MS,
    // The external F10 bridge is held precisely while the window sits behind
    // the game, so this poll above all others must survive backgrounding.
    refetchIntervalInBackground: true
  });

  const listening = query.data?.state === "listening";
  // `dataUpdatedAt` (not `data`) is the dep on purpose: react-query's structural
  // sharing keeps the SAME object across identical responses, so `data` alone
  // would fire once and then let the store's freshness stamp go stale mid-hold.
  // Every tick re-asserting is what makes the stamp a heartbeat; the store
  // no-ops the idle ticks, so this costs nothing while nothing is held.
  useEffect(() => {
    useAvatarLiveState.getState().setListening(listening);
  }, [listening, query.dataUpdatedAt]);
}

const KEEPALIVE_MS = 1000;
const PTT_FLUSH_POLL_QUERY_KEY = ["ptt-flush-poll"] as const;

/** UI-facing lifecycle. `connecting` is the local gap between pointerdown/
 * keydown and start() resolving — deliberately distinct from `listening` so
 * the card never shows "Escuchando…" optimistically (UX spec). */
export type PttUiState = "idle" | "connecting" | "listening" | "flushing";

/** Fixed literal the caller renders into copy — never free text. */
export type PttErrorCode = "stt_unreachable" | "stt_lost" | "session_not_active" | "start_failed";

export interface UsePttHoldResult {
  state: PttUiState;
  error: PttErrorCode | null;
  start: () => void;
  stop: () => void;
}

/**
 * Hold-to-talk session lifecycle: start() -> POST /api/ptt/start, a 1Hz
 * keepalive while listening (the client-side half of the server guillotine),
 * stop() -> POST /api/ptt/stop, then polls GET /api/ptt/state at 1s until
 * the backend's 5s grace+flush converges back to idle. Every exit path
 * (explicit stop, keepalive 409/network loss, unmount, and the fast-tap race
 * below) converges on the same "stop whatever is open, go idle" routine —
 * never leaves a session conceptually open.
 */
export function usePttHold(): UsePttHoldResult {
  const [state, setState] = useState<PttUiState>("idle");
  const [error, setError] = useState<PttErrorCode | null>(null);
  const stateRef = useRef<PttUiState>("idle");
  const sessionIdRef = useRef<string | null>(null);
  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const setUiState = useCallback((next: PttUiState) => {
    const prev = stateRef.current;
    stateRef.current = next;
    // Shared avatar signal: only real EDGES of the live-mic state are published,
    // so a second hook instance idling on another surface can never stomp an
    // open hold. "listening" is the only state that means a live mic —
    // connecting and flushing must not light the avatar up.
    if (next === "listening") useAvatarLiveState.getState().setListening(true);
    else if (prev === "listening") useAvatarLiveState.getState().setListening(false);
    if (mountedRef.current) setState(next);
  }, []);

  const clearKeepalive = useCallback(() => {
    if (keepaliveRef.current !== null) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
  }, []);

  const goIdle = useCallback(
    (code?: PttErrorCode) => {
      clearKeepalive();
      sessionIdRef.current = null;
      if (mountedRef.current) {
        if (code) setError(code);
        setUiState("idle");
      }
    },
    [clearKeepalive, setUiState]
  );

  // No meta.event on either mutation: PTT lifecycle toasts + feed entries are
  // single-sourced on the SERVER echo (ptt.started/stopped via GET /api/events,
  // see src/api/events.ts + the ptt.* toast exception in appEvents.ts). The old
  // mutation-meta path double-emitted alongside that echo, and left the
  // external F10 bridge (server events only) invisible.
  const startMutation = useMutation({ mutationFn: postPttStart });
  const stopMutation = useMutation({
    mutationFn: (sessionId: string | undefined) => postPttStop(sessionId)
  });

  const beginKeepalive = useCallback(
    (sessionId: string) => {
      clearKeepalive();
      keepaliveRef.current = setInterval(() => {
        postPttKeepalive(sessionId)
          .then((res) => {
            if (res.state !== "listening") {
              clearKeepalive();
              return;
            }
            // Heartbeat for the shared avatar signal: re-stamping it every beat
            // is what lets a hold outlive the freshness window in KiraCover.
            useAvatarLiveState.getState().setListening(true);
          })
          .catch((err: unknown) => {
            // Keepalive error (409 session moved on or network lag):
            // Stop polling locally, drop to idle, and surface the error.
            clearKeepalive();
            if (mountedRef.current) {
              setError(err instanceof ApiError && err.status === 409 ? "session_not_active" : "stt_lost");
              setUiState("idle");
            }
          });
      }, KEEPALIVE_MS);
    },
    [clearKeepalive]
  );

  const start = useCallback(() => {
    if (stateRef.current !== "idle") return; // guard: pointerdown + keydown can both fire for one press
    setError(null);
    setUiState("connecting");
    startMutation.mutate(undefined, {
      onSuccess: (data) => {
        if (stateRef.current !== "connecting") {
          // stop() (or unmount) already fired while start() was still in
          // flight (a very fast tap) — don't resurrect a session nobody is
          // holding; cut it immediately instead of waiting out the server's
          // 8s keepalive watchdog.
          void postPttStop(data.session_id);
          return;
        }
        sessionIdRef.current = data.session_id;
        setUiState("listening");
        beginKeepalive(data.session_id);
      },
      onError: (err: unknown) => {
        setUiState("idle");
        if (mountedRef.current) {
          setError(err instanceof ApiError && err.status === 503 ? "stt_unreachable" : "start_failed");
        }
        emitAppEvent({ source: "ptt", action: "error" });
      }
    });
  }, [beginKeepalive, setUiState, startMutation]);

  const stop = useCallback(() => {
    if (stateRef.current !== "listening" && stateRef.current !== "connecting") return;
    clearKeepalive();
    const sessionId = sessionIdRef.current ?? undefined;
    sessionIdRef.current = null;
    setUiState("flushing");
    stopMutation.mutate(sessionId);
  }, [clearKeepalive, setUiState, stopMutation]);

  // Poll GET /api/ptt/state at 1s while flushing (not holding) — the client
  // side of "converges back to idle" once the server's grace window elapses.
  const flushPoll = useQuery({
    queryKey: PTT_FLUSH_POLL_QUERY_KEY,
    queryFn: getPttState,
    enabled: state === "flushing",
    refetchInterval: 1000,
    // Keeps polling while the window is covered: releasing a hold from behind
    // OBS or a fullscreen game must still converge to idle, otherwise the card
    // sits on "Procesando…" until the operator focuses the window.
    refetchIntervalInBackground: true
  });

  useEffect(() => {
    if (state === "flushing" && flushPoll.data?.state === "idle") {
      setUiState("idle");
    }
  }, [state, flushPoll.data, setUiState]);

  // Unmount safety net: never leave a session conceptually open (mirrors the
  // pointer/keyboard release paths). Fires even if start() is still pending.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearKeepalive();
      if (stateRef.current === "listening" || stateRef.current === "connecting") {
        void postPttStop(sessionIdRef.current ?? undefined);
      }
    };
  }, [clearKeepalive]);

  return { state, error, start, stop };
}
