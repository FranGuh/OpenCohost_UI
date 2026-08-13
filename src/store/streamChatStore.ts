import { create } from "zustand";
import type { StreamChatMessage, StreamChatMessagesResponse } from "../api/stream.js";

/** Ring-buffer cap. Mirrors the backend's own ChatFeedSink deque(maxlen=200)
 * (opencohost/api/engine_host.py) — the server itself never keeps more than
 * this, so buffering more client-side would just hold stale rows nobody can
 * ever refill from a poll. Eviction is oldest-first, same as eventStore's
 * EVENT_CAP. */
export const STREAM_CHAT_CAP = 200;

export type StreamChatBreakKind = "boot" | "session" | "gap";

/**
 * An ANCHORED break in the feed: `seq` is the seq of the first message that
 * arrived AFTER the break, i.e. the row the panel draws a divider above.
 *
 * Deliberately anchored instead of counted. A plain counter (the shape this
 * replaced) only ever goes up, so one reconnect pinned a banner above the
 * WHOLE list for the rest of the app session — hours later, above 200 rows
 * that all belonged to the current connection. Anchoring also gives pruning
 * for free: once eviction pushes the anchor row out of the buffer, the
 * divider has nothing to sit above and is dropped.
 */
export interface StreamChatBreak {
  seq: number;
  kind: StreamChatBreakKind;
}

export interface StreamChatState {
  messages: StreamChatMessage[];
  cursor: number;
  boot: number | null;
  session: number | null;
  /** Ascending by seq. See StreamChatBreak. */
  breaks: StreamChatBreak[];
  /** A break that has nothing to anchor to YET, held until the next message
   * arrives. See the boot branch in ingest for the case that needs it. */
  pendingBreak: StreamChatBreakKind | null;
  ingest(response: StreamChatMessagesResponse): void;
}

function cap(messages: StreamChatMessage[]): StreamChatMessage[] {
  return messages.length > STREAM_CHAT_CAP ? messages.slice(messages.length - STREAM_CHAT_CAP) : messages;
}

/**
 * LOCAL UI state ONLY (same "never holds server truth beyond this buffer"
 * contract as eventStore/switchStore) — but UNLIKE eventStore, this store
 * DOES hold real viewer message text. That's a deliberate, scoped exception:
 * this buffer is fed exclusively by GET /api/stream/chat-live/messages,
 * which is operator-token-gated and only ever returns text that already
 * passed the aggregator's filter/spam/safety screen (see
 * src/api/stream.ts's rewritten docstring for the full chain). It is an
 * in-memory ring buffer only — never persisted, never sent anywhere else,
 * and it dies with the tab.
 */
export const useStreamChatStore = create<StreamChatState>((set) => ({
  messages: [],
  cursor: 0,
  boot: null,
  session: null,
  breaks: [],
  pendingBreak: null,
  ingest: (response) =>
    set((state) => {
      // Engine restart: the backend's `seq` counter resets to 1 on the new
      // process (see ChatFeedSink docstring), so dedup-by-seq below would
      // read every post-restart message as "already seen" (seq <= whatever
      // was highest before) and silently drop the entire new stream.
      const bootChanged = state.boot !== null && response.boot !== state.boot;
      // Session change (channel connect/reconnect): the server bumps
      // `session` on every successful connect — including a reconnect to
      // the SAME channel — and clears its own buffer at that moment. Unlike
      // `boot`, `seq` stays monotonic across a session change (only a
      // process restart resets it), so the dedup-by-highest-seq below would
      // read every message from the new connection as already-seen/mid-
      // stream and silently MERGE it with the previous channel's tail
      // instead of detecting the switch. `session` is the only signal that
      // catches this, so this check MUST run before the dedup branch below.
      const sessionChanged = state.session !== null && response.session !== state.session;
      if (bootChanged || sessionChanged) {
        const messages = cap(response.messages);
        const kind: StreamChatBreakKind = bootChanged ? "boot" : "session";
        // Only announce a break when history was ACTUALLY dropped — the
        // divider's whole claim is "you lost earlier messages".
        // `Aggregator.connect()` bumps the session on the FIRST connect of the
        // process (0 -> 1) with nothing buffered behind it, and over an empty
        // list that claim is simply false.
        const droppedHistory = state.messages.length > 0;
        return {
          messages,
          cursor: response.cursor,
          boot: response.boot,
          session: response.session,
          breaks: droppedHistory && messages.length > 0 ? [{ seq: messages[0].seq, kind }] : [],
          // A boot change almost always arrives EMPTY, so there is no row to
          // anchor to yet: the poll that reveals the restart was sent with the
          // pre-restart `since`, and the restarted process's seq counter starts
          // back at 1, so the server filters every message out. Hold the break
          // and pin it to the first message of the next poll — by then
          // useStreamChatMessages has reset the cursor to 0. Without this the
          // operator watches the list empty out and refill with no explanation
          // at all, which is the failure the boot signal exists to prevent.
          pendingBreak: droppedHistory && messages.length === 0 ? kind : null
        };
      }
      const highestSeq = state.messages.length > 0 ? state.messages[state.messages.length - 1].seq : 0;
      const fresh = response.messages.filter((m) => m.seq > highestSeq);
      if (fresh.length === 0 && state.boot === response.boot) return state; // no-op, no rerender
      const messages = cap([...state.messages, ...fresh]);
      // The server pages 50 messages per poll over a 200-deep deque, so above
      // roughly 33 msg/s sustained it evicts messages this client never
      // received. The backend gives no drop counter — the seq jump IS the
      // you-fell-behind signal, and until now nothing read it. `highestSeq > 0`
      // keeps a mid-stream FIRST poll (the operator simply joined late) from
      // reading as a loss.
      const gap =
        highestSeq > 0 && fresh.length > 0 && fresh[0].seq > highestSeq + 1
          ? ({ seq: fresh[0].seq, kind: "gap" } as const)
          : null;
      // A reset that arrived with nothing to anchor to finally gets its row.
      // Mutually exclusive with `gap` in practice: a reset empties the buffer,
      // so highestSeq is 0 and the gap check above is guarded on highestSeq > 0.
      const anchored =
        state.pendingBreak !== null && fresh.length > 0
          ? ({ seq: fresh[0].seq, kind: state.pendingBreak } as const)
          : null;
      const oldest = messages.length > 0 ? messages[0].seq : 0;
      let breaks = state.breaks;
      if (anchored) breaks = [...breaks, anchored];
      if (gap) breaks = [...breaks, gap];
      // Breaks are appended in ascending seq order, so the first one is the
      // only candidate for eviction-pruning.
      if (breaks.length > 0 && breaks[0].seq < oldest) breaks = breaks.filter((b) => b.seq >= oldest);
      return {
        messages,
        cursor: response.cursor,
        boot: response.boot,
        session: response.session,
        breaks,
        pendingBreak: anchored ? null : state.pendingBreak
      };
    })
}));

export const selectStreamChatMessages = (state: StreamChatState) => state.messages;
export const selectStreamChatBreaks = (state: StreamChatState) => state.breaks;
/** PRIMITIVE (number | null), not the array. A consumer that only needs "is
 * there something newer than what I've seen" — ConversationPanel's unread dot,
 * mounted in EVERY section — must not subscribe to `messages`: that array's
 * identity changes on every ingest, so the whole panel re-rendered on every
 * 1.5s poll during active chat. */
export const selectStreamChatLatestSeq = (state: StreamChatState) =>
  state.messages.length > 0 ? state.messages[state.messages.length - 1].seq : null;
