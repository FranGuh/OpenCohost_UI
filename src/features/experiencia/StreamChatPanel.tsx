import { Fragment, memo, useEffect, useMemo, useRef } from "react";
import { ApiError } from "../../api/client.js";
import { useStreamChatLiveQuery, useStreamChatMessages } from "../../api/stream.js";
import type { StreamChatMessage } from "../../api/stream.js";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";
import type { TKey } from "../../i18n/t.js";
import { KiraFace } from "../../ui/KiraFace.js";
import { Markdown } from "../../ui/Markdown.js";
import {
  selectKiraStreamReplies,
  selectStreamChatBreaks,
  selectStreamChatMessages,
  useStreamChatStore
} from "../../store/streamChatStore.js";
import type { KiraStreamReply, StreamChatBreakKind } from "../../store/streamChatStore.js";

/**
 * Stream chat tab (RF3, tauri_stream_chat_20260812) — a READ-ONLY view of
 * live viewer chat, mirrored here so the operator can read it from any
 * section without navigating to Stream. All controls (connect/disconnect/
 * limits) stay in src/features/stream/StreamPanel.tsx; this panel renders
 * the StreamChatMessage fields (seq/author/text/ts) plus, interleaved by
 * timestamp, Kira's own replies to that chat (kiraReplies — see
 * streamChatStore.ts). It does not build moderation actions, a reply box, a
 * "which viewer message Kira picked" marker, or a filtered-message counter:
 * the backend can't feed the last two today, and the first two are simply
 * out of scope for a read-only mirror.
 *
 * Design intent (do not flatten a VIEWER row into a bubble like
 * ConversationTurn): viewer chat must look visibly DIFFERENT from Kira's own
 * bubble, or the operator could misread who said what. Dense
 * mono-timestamped rows for viewers, the same Kira bubble ConversationPanel
 * uses for everything else — that contrast is a correctness property here,
 * not decoration.
 */

// Same reasoning + same hardcoded locale as LogsPanel.tsx's TS_FORMAT and
// ConversationPanel.tsx's TURN_TIME_FORMAT: built once at module scope
// instead of per-row per-render. Tabs keeps this panel mounted even while
// hidden (src/ui/Tabs.tsx), so a per-render formatter would keep paying that
// cost with nobody even looking at it.
const TS_FORMAT = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });

// A tiny hash of the username into a small, calm set of theme tone classes
// ALREADY used everywhere as text color utilities (text-ok/text-info/
// text-warn/text-danger/text-dim — see LogsPanel.tsx's TONE_TINT for the
// same convention) — deliberately NOT the Kira spectrum colors
// (--kira-cyan/violet/pink): those are Kira's own visual identity, and
// reusing them here would defeat the point of a viewer row never reading as
// a Kira line.
const AUTHOR_COLORS = ["text-ok", "text-info", "text-warn", "text-danger", "text-dim"] as const;

function authorColorClass(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i++) hash = (hash * 31 + author.charCodeAt(i)) | 0;
  return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length];
}

// Matches LogsPanel's own follow-distance constant.
const NEAR_BOTTOM_PX = 80;

const BREAK_COPY: Record<StreamChatBreakKind, TKey> = {
  boot: "experiencia.streamChatPanel.state.restarted",
  session: "experiencia.streamChatPanel.state.sessionReset",
  gap: "experiencia.streamChatPanel.state.gap"
};

/**
 * `messages` and `kiraReplies` are separate store slices (see
 * streamChatStore.ts's KiraStreamReply docstring for why) — this is the
 * RENDER-time-only merge, sorted by `ts`. Never persisted, rebuilt every
 * render from the two source arrays.
 */
type StreamFeedRow =
  | { kind: "viewer"; key: string; ts: number; message: StreamChatMessage }
  | { kind: "kira"; key: string; ts: number; reply: KiraStreamReply };

interface StreamChatRowProps {
  message: StreamChatMessage;
}

function StreamChatRowImpl({ message }: StreamChatRowProps) {
  // message.ts is Python time.time() (seconds) — *1000 for a JS Date, same
  // convention as ConversationPanel's TurnTime / ServerEvent.ts.
  const ms = message.ts * 1000;
  return (
    <li className="flex items-baseline gap-2 py-0.5">
      <time dateTime={new Date(ms).toISOString()} className="mono shrink-0 text-[10px] tabular-nums text-dim">
        {TS_FORMAT.format(ms)}
      </time>
      <span className={cn("mono shrink-0 text-[11px] font-semibold", authorColorClass(message.author))}>
        {message.author}
      </span>
      {/* NOT mono — mono on a whole prose line destroys legibility; mono on
          the time/author columns above is enough to get the dense-row feel. */}
      <span className="min-w-0 break-words text-[13px] text-foreground">{message.text}</span>
    </li>
  );
}

// Memoized for the same reason ConversationTurn is (ConversationPanel.tsx):
// every row would otherwise re-render on every 1.5s poll tick even when its
// own message content never changes.
const StreamChatRow = memo(StreamChatRowImpl);

interface KiraStreamReplyRowProps {
  reply: KiraStreamReply;
}

/**
 * Kira's reply to viewer chat, interleaved into the same list as
 * StreamChatRow above — but styled like her bubble in ConversationTurn
 * (ConversationPanel.tsx: KiraBadgeLabel + the same rounded/bordered
 * markdown bubble classes), not like a dense viewer row. That contrast is
 * the whole point: nobody should have to guess who's talking.
 */
function KiraStreamReplyRowImpl({ reply }: KiraStreamReplyRowProps) {
  return (
    <li className="flex flex-col gap-1 py-1">
      <span className="mono inline-flex w-fit items-center gap-[6px] text-[11px] font-semibold tracking-[0.06em] text-[var(--kira-cyan)]">
        <KiraFace size={16} aria-hidden />
        KIRA
        <time dateTime={new Date(reply.ts).toISOString()} className="tabular-nums text-dim">
          {TS_FORMAT.format(reply.ts)}
        </time>
      </span>
      <div className="w-full min-w-0 rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-[13px] text-foreground">
        <Markdown content={reply.text} />
      </div>
    </li>
  );
}

const KiraStreamReplyRow = memo(KiraStreamReplyRowImpl);

interface StreamChatHeaderProps {
  connected: boolean;
  channel: string;
}

/** One-line, read-only strip — connection state + a pointer to where the
 * actual controls live. This is NOT a second control panel. */
function StreamChatHeader({ connected, channel }: StreamChatHeaderProps) {
  const t = useT();
  return (
    <p className="mono flex items-center gap-2 border-b border-border-soft px-3 py-1.5 text-[11px]">
      <span className={connected ? "text-ok" : "text-dim"}>
        {connected
          ? t("experiencia.streamChatPanel.header.connected", { channel })
          : t("experiencia.streamChatPanel.header.disconnected")}
      </span>
      <span className="ml-auto text-dim">{t("experiencia.streamChatPanel.header.hint")}</span>
    </p>
  );
}

interface StreamChatPanelProps {
  /** True only while the Stream tab is the active one. Tabs keeps this panel
   * MOUNTED even when hidden (src/ui/Tabs.tsx), so without this the store
   * subscription below still re-renders and re-maps up to 200 rows on every
   * 1.5s poll while nobody is looking — the exact trap already paid for
   * twice in this codebase (LogsPanel.tsx's TS_FORMAT comment,
   * ConversationPanel.tsx's TURN_TIME_FORMAT comment). */
  active: boolean;
}

export function StreamChatPanel({ active }: StreamChatPanelProps) {
  const t = useT();
  // ponytail: the poll lives HERE, not lifted up into ConversationPanel —
  // Tabs keeps this panel mounted while hidden (src/ui/Tabs.tsx), so the
  // hook keeps polling off-tab and ConversationPanel's unread dot (keyed off
  // the newest seq in the store) can still light up.
  //
  // This hook and every store subscription below MUST stay ABOVE the
  // render-gate at the bottom of this function (react hook-order rules make
  // that mandatory anyway) — this is a RENDER gate, not a POLL gate. If
  // someone later "simplifies" this by moving the hook inside an
  // `if (!active) return null`, the poll stops while off-tab, the unread dot
  // stops lighting up, and a long stretch off-tab can overrun the server's
  // 200-deep buffer with nothing draining it.
  const messagesQuery = useStreamChatMessages();
  const messages = useStreamChatStore(selectStreamChatMessages);
  const breaks = useStreamChatStore(selectStreamChatBreaks);
  const kiraReplies = useStreamChatStore(selectKiraStreamReplies);
  // Read-only: the connect/disconnect/limits mutations stay in StreamPanel.
  const chatLive = useStreamChatLiveQuery();
  const connected = chatLive.data?.connected ?? false;
  const channel = chatLive.data?.source_id ?? chatLive.data?.platform ?? "";

  const forbidden =
    messagesQuery.isError && messagesQuery.error instanceof ApiError && messagesQuery.error.status === 403;
  // Any OTHER poll failure (engine died or restarted mid-poll). The chat-live
  // cache can still be reporting `connected:true` from its last good answer,
  // so without this the operator reads frozen rows under a "Conectado" header
  // — a dead feed dressed as a live one. Rows stay visible: they were real.
  const stalled = messagesQuery.isError && !forbidden;

  // The merge: viewer messages (ts in seconds — *1000, same convention as
  // StreamChatRowImpl's own per-row conversion) interleaved with Kira's
  // replies (ts already in ms), ordered ascending.
  const feed = useMemo<StreamFeedRow[]>(() => {
    const viewerRows: StreamFeedRow[] = messages.map((message) => ({
      kind: "viewer",
      key: `v-${message.seq}`,
      ts: message.ts * 1000,
      message
    }));
    const kiraRows: StreamFeedRow[] = kiraReplies.map((reply) => ({
      kind: "kira",
      key: `k-${reply.turnId}`,
      ts: reply.ts,
      reply
    }));
    return [...viewerRows, ...kiraRows].sort((a, b) => a.ts - b.ts);
  }, [messages, kiraReplies]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRowKey = feed.length > 0 ? feed[feed.length - 1].key : null;
  const prevLastRowKeyRef = useRef<string | null>(null);

  // Follow-the-bottom, keyed on the identity of the last row — NOT on the row
  // count. Same reasoning (and same trap) as ConversationPanel's lastTurnId:
  // the store caps at STREAM_CHAT_CAP with one-in-one-out eviction, so on a
  // real stream the count freezes at 200 within minutes and a count-based
  // "did it grow" test is false forever after that, silently killing
  // auto-scroll exactly when the feed is busiest. Keyed on the merged feed
  // (not just `messages`) so a Kira-only arrival — no new viewer message,
  // just her reply landing — still triggers the follow. Pure scrollTop math,
  // same jsdom-testable approach as LogsPanel.tsx (no IntersectionObserver).
  useEffect(() => {
    const el = scrollRef.current;
    const appended = lastRowKey !== null && lastRowKey !== prevLastRowKeyRef.current;
    prevLastRowKeyRef.current = lastRowKey;
    if (!el || !appended) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastRowKey]);

  // Jump to newest on activation. While inactive the row list below renders
  // null (the render gate), so the follow-the-bottom effect above — keyed on
  // the last seq, not on `active` — either never runs against the real
  // (tall) content or runs against a collapsed container. Either way,
  // reactivating with up to 200 rows arriving at once would otherwise leave
  // scrollTop wherever it last was (commonly 0), landing the operator on the
  // OLDEST message. A live chat feed always opens at the newest one.
  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active]);

  const breakBySeq = useMemo(() => new Map(breaks.map((b) => [b.seq, b.kind])), [breaks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StreamChatHeader connected={connected} channel={channel} />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {forbidden ? (
          <p className="text-[13px] text-dim">{t("experiencia.streamChatPanel.state.forbidden")}</p>
        ) : !active ? null : (
          <>
            {stalled && (
              <p role="status" className="mono mb-1 text-[10px] text-warn">
                {t("experiencia.streamChatPanel.state.stalled")}
              </p>
            )}
            {/* Rows are gated on HAVING rows, never on `connected`. The
                connect POST answers connected:false (daemon thread) and the
                /vivo path never writes that cache at all, so gating the list
                on it showed "no hay canal conectado" over a live, ingesting
                feed; and the backend deliberately RETAINS the last 200
                messages after a disconnect, which the same gate threw away.
                Connection state belongs in the header above. */}
            {feed.length === 0 ? (
              <p className="text-[13px] text-dim">
                {connected
                  ? t("experiencia.streamChatPanel.state.empty")
                  : t("experiencia.streamChatPanel.state.notConnected")}
              </p>
            ) : (
              // ponytail: cap (STREAM_CHAT_CAP) + memoized rows, no
              // virtualization — same house recipe as LogsPanel/ConversationPanel.
              <ul aria-label={t("experiencia.streamChatPanel.list.aria")} className="flex flex-col gap-0.5">
                {feed.map((row) => {
                  if (row.kind === "kira") return <KiraStreamReplyRow key={row.key} reply={row.reply} />;
                  // Anchored divider: sits above the first row that arrived
                  // after the break, and disappears on its own once eviction
                  // pushes that row out of the buffer. Kira rows above have no
                  // `seq` and never carry a divider.
                  const kind = breakBySeq.get(row.message.seq);
                  return (
                    <Fragment key={row.key}>
                      {kind && <li className="mono py-0.5 text-[10px] text-dim">{t(BREAK_COPY[kind])}</li>}
                      <StreamChatRow message={row.message} />
                    </Fragment>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
