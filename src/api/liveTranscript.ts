import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPttState, type PttStateResponse } from "./ptt.js";

/**
 * Live transcript echo (transcript-echo follow-up to liveaudio_ptt_tauri):
 * while a PTT hold is active, the webview opens its OWN recv-only WebSocket
 * to LiveAudio's broadcast server — the exact pattern the OBS browser source
 * (liveaudio/assets/subtitulos_obs.html) already uses. LiveAudio fans every
 * utterance out to ALL connected localhost clients (websockets.broadcast in
 * liveaudio/core/network.py), so this viewer can never steal segments from
 * the backend PttSession sharing the same socket.
 *
 * PRIVACY (hard rule 2): the transcript still NEVER crosses the OpenCohost
 * HTTP API. The only thing the API contributes is `stt_ws_url` — an address,
 * not text — on GET /api/ptt/state; the words travel LiveAudio WS -> this
 * hook -> one local chat bubble, full stop.
 *
 * Lifecycle is driven by polling GET /api/ptt/state (1 Hz, same cadence as
 * usePttHold's flush poll) because that state covers BOTH hold surfaces: the
 * in-app composer mic AND the external F10 bridge, whose sessions only ever
 * surface server-side. listening/flushing -> connect + accumulate; back to
 * idle -> resolve the final text once, disconnect. Degradations are silent:
 * no WS, a connect failure, or a mid-hold drop just means no echo — the hold
 * itself is untouched.
 */

/** GET /api/ptt/state grew a read-only `stt_ws_url` field (backend
 * PttStateResponse). ptt.ts is owned by the PTT track, so the extension
 * lives here instead of widening its interface. */
interface PttStateWithWsUrl extends PttStateResponse {
  stt_ws_url?: string | null;
}

const POLL_MS = 1000;

// Ingest parity with the backend consumer (opencohost/api/ptt_session.py):
// the echoed bubble must match what PttSession actually dispatched to Kira.
// Same anti-loop stutter collapse (a phrase repeated 3+ times -> once), same
// 2000-char soft cap, same "under two words is not a turn" rule.
const ANTILOOP_RE = /\b(.+?)(?:\s+\1\b){2,}/gi;
const MAX_CHARS = 2000;
const MIN_WORDS = 2;

/**
 * Fold one raw WS frame into the running buffer. Frames without a non-empty
 * `text` field (the `hello` handshake, `theme` pushes, malformed JSON) are
 * ignored — identical to PttSession._ingest, which only ever reads `.text`.
 */
export function appendSegment(buffer: string, raw: unknown): string {
  if (typeof raw !== "string") return buffer;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return buffer;
  }
  if (data === null || typeof data !== "object") return buffer;
  const rawText = (data as { text?: unknown }).text;
  if (typeof rawText !== "string") return buffer;
  const cleaned = rawText.trim().replace(ANTILOOP_RE, "$1").trim();
  if (!cleaned) return buffer;
  if (buffer.length >= MAX_CHARS) return buffer; // soft cap: drop the rest
  return buffer ? `${buffer} ${cleaned}` : cleaned;
}

/** Resolve the hold's final text: the trimmed buffer, or "" when it holds
 * fewer than two words — the backend flushes nothing in that case, so
 * echoing a bubble would fake a turn Kira never received. */
export function finalizeTranscript(buffer: string): string {
  const text = buffer.trim();
  return text.split(/\s+/).filter(Boolean).length >= MIN_WORDS ? text : "";
}

/**
 * Observe the server-side PTT lifecycle and echo the spoken text.
 * `onTranscript` fires at most once per hold, only with a valid (>= 2 words)
 * final transcript, after the backend has flushed (state back to idle).
 */
export function useLiveTranscript(onTranscript: (text: string) => void): void {
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;
  const wsRef = useRef<{ close: () => void } | null>(null);
  const bufferRef = useRef("");
  // True once a connect attempt for the CURRENT hold happened (even a failed
  // one) — a mid-hold failure must not retrigger connects every poll tick.
  const attemptedRef = useRef(false);

  const poll = useQuery({
    queryKey: ["live-transcript-ptt-state"],
    queryFn: getPttState,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false
  });

  const data = poll.data as PttStateWithWsUrl | undefined;
  // flushing counts as active: segments spoken right before release are
  // broadcast during the backend's 5s grace window and must still land.
  const active = data?.state === "listening" || data?.state === "flushing";
  const wsUrl = data?.stt_ws_url ?? null;

  useEffect(() => {
    if (active && !attemptedRef.current) {
      attemptedRef.current = true;
      bufferRef.current = "";
      if (!wsUrl) return; // older backend / no URL — degrade silently, no echo
      try {
        const ws = new WebSocket(wsUrl);
        ws.onmessage = (event: MessageEvent) => {
          bufferRef.current = appendSegment(bufferRef.current, event.data);
        };
        // No mid-hold reconnect (matches PttSession: deliver what was heard).
        // wsRef stays set so this hold never dials again; onerror/onclose are
        // left alone — the browser closes the socket, we keep the buffer.
        wsRef.current = ws;
      } catch {
        wsRef.current = null; // constructor refused (bad URL, no WS runtime)
      }
    } else if (!active && attemptedRef.current) {
      const text = finalizeTranscript(bufferRef.current);
      bufferRef.current = "";
      attemptedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      if (text) callbackRef.current(text);
    }
  }, [active, wsUrl]);

  // Unmount: close quietly, no echo — nobody is left to render it.
  useEffect(
    () => () => {
      wsRef.current?.close();
      wsRef.current = null;
    },
    []
  );
}
