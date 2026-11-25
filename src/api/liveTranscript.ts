import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PTT_STATE_QUERY_KEY, getPttState, type PttStateResponse } from "./ptt.js";
import { useEventStore } from "../store/eventStore.js";

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
  /** True only while the current hold (or its grace flush) is locked to
   * dictate; decided by the backend at hold start (ptt-live-dictation). */
  dictation?: boolean;
}

const POLL_MS = 1000;

// Ingest parity with the backend consumer (opencohost/api/ptt_session.py):
// the echoed bubble must match what PttSession actually dispatched to Kira.
// Same anti-loop stutter collapse (a phrase repeated 3+ times -> once), same
// 2000-char soft cap, same "under two words is not a turn" rule.
const ANTILOOP_RE = /\b(.+?)(?:\s+\1\b){2,}/gi;
const MAX_CHARS = 2000;
const MIN_WORDS = 2;
// The webview opens its socket up to one state poll (POLL_MS) after the hold
// began, so this hold's first cue may predate the socket by about that much.
const REPLAY_SLACK_SEC = 1.5;

/**
 * Fold one raw WS frame into the running buffer. Frames without a non-empty
 * `text` field (the `hello` handshake, `theme` pushes, malformed JSON) are
 * ignored — identical to PttSession._ingest, which only ever reads `.text`.
 * Frames with `is_replay === true` are either LiveAudio's late-joiner replay
 * burst (the previous hold's cues) or a delayed LIVE cue (LiveAudio flags any
 * cue older than 1 s under its auto backlog policy, e.g. slow CPU ASR). Same
 * rule as PttSession._ingest: a flagged cue whose `created_at` (epoch seconds)
 * is at or after `connectedAtSec` minus REPLAY_SLACK_SEC is this hold's speech
 * and is kept; older ones, or any without `created_at`, are dropped. Frames
 * without the field are kept.
 */
export function appendSegment(buffer: string, raw: unknown, connectedAtSec = 0): string {
  if (typeof raw !== "string") return buffer;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return buffer;
  }
  if (data === null || typeof data !== "object") return buffer;
  if ((data as { is_replay?: unknown }).is_replay === true) {
    const createdAt = (data as { created_at?: unknown }).created_at;
    const ownHold =
      typeof createdAt === "number" && connectedAtSec > 0 && createdAt >= connectedAtSec - REPLAY_SLACK_SEC;
    if (!ownHold) return buffer;
  }
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

/** ptt.* rows in the app-event store (server echoes carry their REAL server ts;
 * the words themselves never cross the HTTP API). */
function pttEvents() {
  return useEventStore.getState().events.filter((event) => event.source === "ptt");
}

/** Hold outcomes: they land AFTER the hold (and possibly after Kira's own
 * reply ts), so they are never borrowed as a bubble's clock. `dictation_lost`
 * is this window's own notice row (ptt-dictation-20261111). */
const OUTCOME_ACTIONS = new Set(["flushed", "empty", "dictated", "dictation_lost"]);

/** Newest server `ptt.*` timestamp usable as a sort key: started/stopped only. */
function newestPttTs(): number {
  return pttEvents().reduce(
    (newest, event) => (!OUTCOME_ACTIONS.has(event.action ?? "") && event.ts > newest ? event.ts : newest),
    0
  );
}

/** How long a finished hold's text may wait for the backend's verdict
 * (`ptt.flushed` / `ptt.empty`, which ride the 1.5s events poll after the
 * backend's 1.2s grace) before it is dropped as unconfirmed. */
const OUTCOME_TIMEOUT_MS = 15_000;

type Verdict = { action: "flushed" | "empty" | "dictated"; id: string };

/** This hold's verdict, or null while it is still unknown. The outcome must be
 * newer than the hold's own `ptt.stopped` when that row is known, else newer
 * than the rising-edge baseline — a previous hold's late `flushed` is older
 * than this hold's `stopped`, so it can never confirm this hold. */
function outcomeSince(baseline: number): Verdict | null {
  const events = pttEvents().filter((e) => e.ts > baseline);
  const stopped = events.filter((e) => e.action === "stopped").reduce((n, e) => Math.max(n, e.ts), 0);
  const floor = stopped > 0 ? stopped : baseline;
  const verdict = events
    .filter((e) => (e.action === "flushed" || e.action === "empty" || e.action === "dictated") && e.ts > floor)
    .sort((x, y) => x.ts - y.ts)[0];
  return verdict ? { action: verdict.action as Verdict["action"], id: verdict.id } : null;
}

/**
 * Dictation mode (ptt-dictation-20261111). The backend skipped the turn and
 * emitted `ptt.dictated`; this window owns the only copy of the words.
 * `onDictated` gets this hold's final text (it is NEVER committed as a sent
 * turn). `onDictationLost` fires when the backend dictated but this window
 * has no usable text (no socket, a failed one, under two words, a hold it
 * never observed) — the caller must show it, never drop silently.
 */
export interface DictationHandlers {
  onDictated: (text: string) => void;
  onDictationLost: () => void;
  /** Live dictation (ptt-live-dictation-20261125): a hold the backend locked
   * to dictate began. The words stream through `onLive` instead of the
   * pending bubble. */
  onLiveStart?: () => void;
  /** The whole live text so far (replaces the previous live span). */
  onLive?: (text: string) => void;
  /** The hold did not end as a dictation (sent, empty, superseded): remove
   * the live span and restore the composer. */
  onLiveCancel?: () => void;
  /** No outcome arrived in time: keep the live text, tell the owner. */
  onDictationTimeout?: () => void;
}

/**
 * Observe the server-side PTT lifecycle and echo the spoken text.
 * `onTranscript` fires at most once per hold, only with a valid (>= 2 words)
 * final transcript, after the backend has flushed (state back to idle).
 *
 * Second argument (`pttStamp`): a server-clock ms reading that belongs to THIS
 * hold, or 0 when the hold produced none — the caller must then fall back to
 * arrival time. Eligibility is per-hold, NOT a running maximum: this poll (1s)
 * and the /api/events poll (1.5s) are independent queries that throttle unevenly
 * while the window sits behind a game, so the newest `ptt.*` row at echo time can
 * still be the PREVIOUS hold's `ptt.stopped` — older than Kira's answer to that
 * previous hold, which is how the second spoken turn ended up rendering above it.
 * So we snapshot the newest ts at the hold's RISING EDGE and only borrow a
 * reading that is strictly greater, i.e. one that demonstrably arrived while this
 * hold's attempt was live. Every such reading is taken inside the hold, before
 * the grace window that dispatches the turn, so it is always strictly before the
 * reply's own server ts.
 *
 * ponytail: a reading STAMPED before this hold but POLLED during it is still
 * borrowable (one events-poll window wide). Closing that needs a server-side
 * flush timestamp on the hold itself; the readings we do have carry no session
 * id (appEvents.ts drops `detail` for every ptt.* label), so nothing client-side
 * can bind a row to a hold.
 */
export function useLiveTranscript(
  onTranscript: (text: string, pttStamp: number) => void,
  onPending?: (text: string | null) => void,
  dictation?: DictationHandlers
): void {
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;
  const pendingCbRef = useRef(onPending);
  pendingCbRef.current = onPending;
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  // `ptt.dictated` rows already answered (consumed by a hold or reported lost).
  const handledDictatedRef = useRef(new Set<string>());
  // Rows older than this mount are backfill from before this window existed.
  const mountedAtRef = useRef(Date.now());
  // A finished hold's text waiting for the backend verdict (see commit rules).
  const awaitingRef = useRef<{
    text: string;
    baseline: number;
    live: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const settle = (verdict: "commit" | "drop" | "dictate" | "timeout") => {
    const waiting = awaitingRef.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    awaitingRef.current = null;
    pendingCbRef.current?.(null);
    if (waiting.live) {
      // The words went into the composer live: only a dictated verdict (or a
      // timeout, which keeps them) leaves them there.
      if (verdict === "timeout") {
        dictationRef.current?.onDictationTimeout?.();
        return;
      }
      if (verdict !== "dictate") dictationRef.current?.onLiveCancel?.();
    } else if (verdict === "timeout") {
      return; // send hold: unconfirmed text is dropped, as before
    }
    if (verdict === "commit" && waiting.text) {
      const newest = newestPttTs();
      callbackRef.current(waiting.text, newest > waiting.baseline ? newest : 0);
    } else if (verdict === "dictate") {
      const handlers = dictationRef.current;
      if (!handlers) return; // no composer to write into: dropped, as before
      if (waiting.text) handlers.onDictated(waiting.text);
      else handlers.onDictationLost();
    }
  };
  const checkOutcome = () => {
    const waiting = awaitingRef.current;
    if (!waiting) return;
    const outcome = outcomeSince(waiting.baseline);
    if (!outcome) return;
    if (outcome.action === "dictated") handledDictatedRef.current.add(outcome.id);
    if (outcome.action === "flushed") settle("commit");
    else if (outcome.action === "empty") settle("drop");
    else settle("dictate");
  };
  // A `ptt.dictated` row with no hold of this window to answer it: the state
  // poll never saw that hold, or the hold's text was superseded. Its words
  // exist nowhere now, so say so (once per row).
  const checkOrphanDictation = () => {
    const handlers = dictationRef.current;
    if (!handlers || attemptedRef.current || awaitingRef.current) return;
    const handled = handledDictatedRef.current;
    const orphan = pttEvents().find(
      (e) => e.action === "dictated" && e.ts > mountedAtRef.current && !handled.has(e.id)
    );
    if (!orphan) return;
    handled.add(orphan.id);
    handlers.onDictationLost();
  };
  const wsRef = useRef<{ close: () => void } | null>(null);
  const bufferRef = useRef("");
  // True once a connect attempt for the CURRENT hold happened (even a failed
  // one) — a mid-hold failure must not retrigger connects every poll tick.
  const attemptedRef = useRef(false);
  // Newest `ptt.*` reading already polled when THIS hold's attempt opened.
  // Anything newer than this at echo time arrived during the hold.
  const pttBaselineRef = useRef(0);
  // This hold was locked to dictate when it began (state.dictation).
  const liveHoldRef = useRef(false);

  const poll = useQuery({
    // Shared with usePttServerSignal (the avatar's listening signal), which
    // polls the same endpoint at the same 1Hz — one query entry means one
    // request per second serving both, instead of two.
    queryKey: PTT_STATE_QUERY_KEY,
    queryFn: getPttState,
    refetchInterval: POLL_MS,
    // Stays live while backgrounded — this is the PTT path the owner reported
    // ("it freezes when I come back and use PTT"): the external F10 bridge is
    // held precisely while the window is behind the game, and this poll is what
    // observes it. See status.ts / backgroundPolling.test.ts.
    refetchIntervalInBackground: true
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
      settle("drop"); // a newer hold supersedes an unconfirmed older one
      pttBaselineRef.current = newestPttTs(); // rising edge: this hold's baseline
      const handlers = dictationRef.current;
      liveHoldRef.current = data?.dictation === true && !!handlers?.onLive;
      if (liveHoldRef.current) handlers?.onLiveStart?.();
      if (!wsUrl) return; // older backend / no URL — degrade silently, no echo
      try {
        const connectedAtSec = Date.now() / 1000;
        const ws = new WebSocket(wsUrl);
        ws.onmessage = (event: MessageEvent) => {
          bufferRef.current = appendSegment(bufferRef.current, event.data, connectedAtSec);
          if (liveHoldRef.current) {
            dictationRef.current?.onLive?.(bufferRef.current.trim());
            return;
          }
          // Live text is only PENDING: it has not reached Kira until the backend says so.
          pendingCbRef.current?.(finalizeTranscript(bufferRef.current) || null);
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
      const baseline = pttBaselineRef.current;
      const live = liveHoldRef.current;
      liveHoldRef.current = false;
      bufferRef.current = "";
      attemptedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      if (!text) {
        pendingCbRef.current?.(null);
        if (dictationRef.current) {
          // Nothing to show or commit, but a `dictated` verdict for this hold
          // means the words are lost: wait for the verdict so it can be told.
          awaitingRef.current = {
            text: "",
            baseline,
            live,
            timer: setTimeout(() => settle(live ? "timeout" : "drop"), OUTCOME_TIMEOUT_MS)
          };
          checkOutcome();
        }
      } else {
        // Do NOT echo yet: the final transcript may never reach Kira (the
        // backend drops under-two-word holds, flush dispatch can fail). Keep it
        // pending until `ptt.flushed`; `ptt.empty` or the timeout discards it.
        awaitingRef.current = {
          text,
          baseline,
          live,
          timer: setTimeout(() => settle(live ? "timeout" : "drop"), OUTCOME_TIMEOUT_MS)
        };
        if (!live) pendingCbRef.current?.(text);
        checkOutcome();
      }
    }
  }, [active, wsUrl]);

  // The verdict rides the events poll, independent of the state poll above.
  useEffect(
    () =>
      useEventStore.subscribe(() => {
        checkOutcome();
        checkOrphanDictation();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Unmount: close quietly, no echo — nobody is left to render it.
  useEffect(
    () => () => {
      wsRef.current?.close();
      wsRef.current = null;
      if (awaitingRef.current) clearTimeout(awaitingRef.current.timer);
      awaitingRef.current = null;
    },
    []
  );
}
