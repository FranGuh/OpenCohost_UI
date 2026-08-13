import { beforeEach, describe, expect, it } from "vitest";
import {
  STREAM_CHAT_CAP,
  selectStreamChatBreaks,
  selectStreamChatLatestSeq,
  selectStreamChatMessages,
  useStreamChatStore
} from "./streamChatStore.js";
import type { StreamChatMessagesResponse } from "../api/stream.js";

type Msg = StreamChatMessagesResponse["messages"][number];

function msg(seq: number, author = "viewer1"): Msg {
  return { seq, author, text: `msg ${seq}`, ts: seq };
}

function response(messages: Msg[], boot = 1, cursor?: number, session = 0): StreamChatMessagesResponse {
  return {
    messages,
    cursor: cursor ?? (messages.length > 0 ? messages[messages.length - 1].seq : 0),
    boot,
    session,
    more_pending: false
  };
}

describe("streamChatStore (bounded ring buffer)", () => {
  beforeEach(() => {
    useStreamChatStore.setState({ messages: [], cursor: 0, boot: null, session: null, breaks: [], pendingBreak: null });
  });

  it("ingest adds messages retrievable via selectStreamChatMessages", () => {
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)]));
    expect(selectStreamChatMessages(useStreamChatStore.getState())).toEqual([msg(1), msg(2)]);
  });

  it("dedups by seq: never appends a seq <= the highest already stored", () => {
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)]));
    useStreamChatStore.getState().ingest(response([msg(2), msg(3)])); // seq 2 repeated in the new batch
    const seqs = selectStreamChatMessages(useStreamChatStore.getState()).map((m) => m.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("returns the identical state object when nothing new arrived (no-rerender no-op)", () => {
    useStreamChatStore.getState().ingest(response([msg(1)]));
    const before = useStreamChatStore.getState();
    useStreamChatStore.getState().ingest(response([msg(1)], 1, 1)); // same seq, same boot, nothing new
    const after = useStreamChatStore.getState();
    expect(before).toBe(after);
  });

  it("caps at STREAM_CHAT_CAP, evicting oldest first, preserving order", () => {
    const flood = Array.from({ length: STREAM_CHAT_CAP + 10 }, (_, i) => msg(i + 1));
    useStreamChatStore.getState().ingest(response(flood));
    const stored = selectStreamChatMessages(useStreamChatStore.getState());
    expect(stored).toHaveLength(STREAM_CHAT_CAP);
    expect(stored[0].seq).toBe(11); // seqs 1-10 evicted
    expect(stored[stored.length - 1].seq).toBe(STREAM_CHAT_CAP + 10);
  });

  it("selectStreamChatLatestSeq returns a primitive, not the array (null when empty)", () => {
    expect(selectStreamChatLatestSeq(useStreamChatStore.getState())).toBeNull();
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)]));
    expect(selectStreamChatLatestSeq(useStreamChatStore.getState())).toBe(2);
  });

  // The important one: the backend's seq counter restarts at 1 on process
  // restart (ChatFeedSink), so dedup-by-seq alone would silently drop every
  // post-restart message forever unless a boot change forces a reset.
  it("resets the buffer and anchors a boot break when boot changes (engine restart)", () => {
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)], 1));
    // What the wire can actually produce: the client is polling with the stale
    // `since=2`, the restarted process has already buffered seq 1..3, and the
    // server filters `seq > since` — so only seq 3 comes back, carrying the new
    // boot. (A response repeating seq 1 and 2 could never reach this client:
    // the server would have filtered both.)
    useStreamChatStore.getState().ingest(response([msg(3)], 2));
    const state = useStreamChatStore.getState();
    expect(selectStreamChatMessages(state).map((m) => m.seq)).toEqual([3]);
    expect(state.boot).toBe(2);
    // Anchored to the first message of the new process, not to a counter.
    expect(selectStreamChatBreaks(state)).toEqual([{ seq: 3, kind: "boot" }]);
  });

  it("does not mark the very first ingest as a restart, even though boot goes from null to a real value", () => {
    useStreamChatStore.getState().ingest(response([msg(1)], 7));
    expect(selectStreamChatBreaks(useStreamChatStore.getState())).toEqual([]);
  });

  // The important one: `seq` stays monotonic across a session change (only a
  // process restart resets it — see the boot test above), so dedup-by-
  // highest-seq alone would read every message from the NEW channel as a
  // continuation of the old one and silently merge the two channels' chat
  // instead of resetting. `session` is the only signal that catches this.
  it("resets the buffer and anchors a session break when session changes, even though seq keeps climbing", () => {
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)], 1, undefined, 0));
    useStreamChatStore.getState().ingest(response([msg(3), msg(4)], 1, undefined, 1)); // same boot, new session, seq keeps climbing
    const state = useStreamChatStore.getState();
    expect(selectStreamChatMessages(state).map((m) => m.seq)).toEqual([3, 4]); // old channel's messages gone, not merged
    expect(state.session).toBe(1);
    expect(selectStreamChatBreaks(state)).toEqual([{ seq: 3, kind: "session" }]);
  });

  it("keeps boot and session breaks distinguishable by kind", () => {
    useStreamChatStore.getState().ingest(response([msg(1)], 1, undefined, 0));
    useStreamChatStore.getState().ingest(response([msg(2)], 1, undefined, 1)); // session reset only
    expect(selectStreamChatBreaks(useStreamChatStore.getState())).toEqual([{ seq: 2, kind: "session" }]);
    useStreamChatStore.getState().ingest(response([msg(3)], 2, undefined, 1)); // boot reset only
    // A reset REPLACES the buffer, so the previous break's anchor row is gone
    // with it — exactly one break survives, the one for the live reset.
    expect(selectStreamChatBreaks(useStreamChatStore.getState())).toEqual([{ seq: 3, kind: "boot" }]);
  });

  it("does not mark the very first ingest as a session reset, even though session goes from null to a real value", () => {
    useStreamChatStore.getState().ingest(response([msg(1)], 1, undefined, 3));
    expect(selectStreamChatBreaks(useStreamChatStore.getState())).toEqual([]);
  });

  // Aggregator.connect() bumps the session on the FIRST connect of the process
  // too (0 -> 1), and at that point nothing is buffered. The divider claims
  // "you lost earlier messages", so recording this would print it above the very
  // first message of the stream — over a list that never held another channel.
  it("records no break for a session change that dropped nothing", () => {
    useStreamChatStore.getState().ingest(response([], 1, undefined, 0)); // polled before any connect
    useStreamChatStore.getState().ingest(response([msg(1)], 1, undefined, 1)); // first connect
    const state = useStreamChatStore.getState();
    expect(state.session).toBe(1);
    expect(selectStreamChatMessages(state).map((m) => m.seq)).toEqual([1]);
    expect(selectStreamChatBreaks(state)).toEqual([]);
  });

  it("records no break for a boot change that dropped nothing", () => {
    useStreamChatStore.getState().ingest(response([], 1, undefined, 0));
    useStreamChatStore.getState().ingest(response([msg(1)], 2, undefined, 0));
    expect(selectStreamChatBreaks(useStreamChatStore.getState())).toEqual([]);
  });

  // The real shape of an engine restart on the wire. The poll that reveals it
  // went out with the pre-restart `since`, and the new process's seq counter
  // starts back at 1, so the server filters everything and the boot change
  // arrives EMPTY. Anchoring is impossible at that moment; without holding the
  // break, the operator watches the list empty out and refill unexplained.
  it("holds a boot break that arrives empty and anchors it to the next message", () => {
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)], 1));
    // Restart revealed by an empty response carrying the new boot.
    useStreamChatStore.getState().ingest(response([], 2, 0));
    let state = useStreamChatStore.getState();
    expect(selectStreamChatMessages(state)).toEqual([]); // old process's messages dropped
    expect(selectStreamChatBreaks(state)).toEqual([]); // nothing to anchor to yet
    expect(state.pendingBreak).toBe("boot");
    // Next poll goes out with the reset cursor and brings the new process's own
    // seq 1 — that row is where the divider belongs.
    useStreamChatStore.getState().ingest(response([msg(1)], 2));
    state = useStreamChatStore.getState();
    expect(selectStreamChatBreaks(state)).toEqual([{ seq: 1, kind: "boot" }]);
    expect(state.pendingBreak).toBeNull();
  });

  it("does not hold a break when the empty reset dropped nothing", () => {
    useStreamChatStore.getState().ingest(response([], 1, undefined, 0));
    useStreamChatStore.getState().ingest(response([], 2, 0, 0));
    expect(useStreamChatStore.getState().pendingBreak).toBeNull();
  });

  // A reset that lands with an EMPTY batch has no seq to anchor to. Recording
  // one anyway would either need a phantom anchor or resurrect the permanent
  // top-of-list banner this replaced.
  it("records no break for a reset that arrives with zero messages", () => {
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)], 1, undefined, 0));
    useStreamChatStore.getState().ingest(response([], 2, 0, 0)); // restarted, nothing buffered yet
    const state = useStreamChatStore.getState();
    expect(selectStreamChatMessages(state)).toEqual([]);
    expect(selectStreamChatBreaks(state)).toEqual([]);
  });
});

// The server pages 50 messages per poll over a 200-deep deque: above ~33 msg/s
// sustained it evicts messages this client never received. The backend gives no
// drop counter — the seq jump IS the you-fell-behind signal.
describe("streamChatStore (seq gap = dropped messages)", () => {
  beforeEach(() => {
    useStreamChatStore.setState({ messages: [], cursor: 0, boot: null, session: null, breaks: [], pendingBreak: null });
  });

  it("anchors a gap break at the first message after a seq jump", () => {
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)]));
    useStreamChatStore.getState().ingest(response([msg(40), msg(41)])); // 3..39 never reached us
    const state = useStreamChatStore.getState();
    expect(selectStreamChatMessages(state).map((m) => m.seq)).toEqual([1, 2, 40, 41]);
    expect(selectStreamChatBreaks(state)).toEqual([{ seq: 40, kind: "gap" }]);
  });

  it("records no gap for a contiguous append", () => {
    useStreamChatStore.getState().ingest(response([msg(1), msg(2)]));
    useStreamChatStore.getState().ingest(response([msg(3), msg(4)]));
    expect(selectStreamChatBreaks(useStreamChatStore.getState())).toEqual([]);
  });

  // Joining mid-stream is not a loss: the operator never had those messages to
  // begin with, and the very first poll legitimately starts at whatever the
  // server's buffer holds.
  it("records no gap on the very first poll, however high the first seq is", () => {
    useStreamChatStore.getState().ingest(response([msg(157), msg(158)]));
    expect(selectStreamChatBreaks(useStreamChatStore.getState())).toEqual([]);
  });

  it("drops a break once eviction pushes its anchor row out of the buffer", () => {
    useStreamChatStore.getState().ingest(response([msg(1)]));
    useStreamChatStore.getState().ingest(response([msg(10)])); // gap anchored at seq 10
    expect(selectStreamChatBreaks(useStreamChatStore.getState())).toEqual([{ seq: 10, kind: "gap" }]);

    // Flood past the cap so seq 10 is evicted — no pruning call anywhere, the
    // anchor simply has no row left to sit above.
    const flood = Array.from({ length: STREAM_CHAT_CAP + 5 }, (_, i) => msg(11 + i));
    useStreamChatStore.getState().ingest(response(flood));
    const state = useStreamChatStore.getState();
    expect(selectStreamChatMessages(state)).toHaveLength(STREAM_CHAT_CAP);
    expect(selectStreamChatMessages(state)[0].seq).toBeGreaterThan(10);
    expect(selectStreamChatBreaks(state)).toEqual([]);
  });
});
