import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { ChevronDown, MessageSquareOff, Mic, MicOff } from "lucide-react";
import { Alert } from "../../ui/Alert.js";
import { COMMAND_PALETTE_LISTBOX_ID, CommandPalettePopover, ComposerCommandPanel } from "../commands/ComposerCommandPanel.js";
import { Input } from "../../ui/Input.js";
import { KiraFace } from "../../ui/KiraFace.js";
import { Markdown } from "../../ui/Markdown.js";
import { Tab, TabList, TabPanel, Tabs } from "../../ui/Tabs.js";
import { matchCommands } from "../commands/registry.js";
import { LogsPanel } from "./LogsPanel.js";
import { useLogsPref } from "../../store/useLogsPref.js";
import { useAgendaEvents } from "../../api/agenda.js";
import { useLastReply, useSendChatTurn } from "../../api/chat.js";
import { useLiveTranscript } from "../../api/liveTranscript.js";
import { usePttHold, type PttUiState } from "../../api/ptt.js";
import { useStatusQuery } from "../../api/status.js";
import { ERROR_COPY } from "../../api/pttCopy.js";
import { cn } from "../../lib/cn.js";
import { selectEvents, useEventStore, type AppEventTone } from "../../store/eventStore.js";

/** Owner layout correction (2026-07-18): ONE unified strip
 * `Todo | Chat | Comandos | Alertas` (+ `Logs` when the pref is on). Todo/Chat/
 * Alertas are feed filters over the single timeline; Comandos swaps to the
 * inline command palette; Logs swaps to the engine event feed. */
type TabValue = "todo" | "chat" | "comandos" | "alertas" | "logs";

/** Fixed feed-tab ids so the shared timeline panel's `aria-labelledby` can name
 * the active filter tab (Todo/Chat/Alertas all control one panel). */
const FEED_TAB_ID: Record<"todo" | "chat" | "alertas", string> = {
  todo: "conv-tab-todo",
  chat: "conv-tab-chat",
  alertas: "conv-tab-alertas"
};

function tabClass(active: boolean): string {
  return cn(
    "h-8 rounded-md px-3 text-[13px] font-semibold text-muted-foreground transition-colors duration-fast ease-io",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    active && "bg-[color:var(--accent-soft)] text-primary"
  );
}

// Auto-scroll follow distance: an append while the operator sits within this
// many px of the bottom follows the stream; further up, we surface the
// jump-to-recent button instead of yanking (Item 3).
const NEAR_BOTTOM_PX = 80;

/** Session-transcript ring-buffer cap. Mirrors eventStore's EVENT_CAP and
 * agenda's AGENDA_EVENT_CAP — the transcript was the last of the three streams
 * feeding this timeline with no bound at all. Every turn is re-mapped,
 * re-sorted and re-filtered on each render, and renders are driven by four
 * independent polls, so an unbounded transcript is a per-render cost multiplier
 * that grows for the whole stream. Eviction is oldest-first; a live timeline
 * wants the recent end. 200 turns is several hours of real conversation.
 * ponytail: plain slice, no windowing/virtualization, no new dependency. */
export const TRANSCRIPT_CAP = 200;

/** Same one-liner idiom as eventStore.ts's append. */
function capTurns(turns: Turn[]): Turn[] {
  return turns.length > TRANSCRIPT_CAP ? turns.slice(turns.length - TRANSCRIPT_CAP) : turns;
}

/** Id of the transient "pensando" row. It is a SENTINEL, not content: appended
 * after the sorted list while a reply is in flight and gone once the reply
 * lands. Named so the auto-scroll effect below can skip it when it asks "what
 * is the last REAL row" — that window is tens of seconds on a heavy local model
 * (dispatch.py documents OLLAMA_CHAT_TIMEOUT as 180s), and while a sentinel owns
 * the bottom-row identity every arrival looks like "nothing new at the end". */
const KIRA_THINKING_ID = "kira-thinking";

/** Unit 4.2 (runtime_findings_batch_20260731, D3b): "esperó Xs en cola" /
 * "esperó 1 min 12 s en cola" — ms -> a short honest label. Only called for
 * a real (>0) wait; a 0ms/instant reply skips the note entirely (see the
 * render site) rather than printing a noisy "esperó 0 s en cola". */
function formatQueueWaitLabel(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** Unit 4.2 (F12 closure): the ANSWERING provider, disclosed as a short human
 * label — "local" is Kira's own machine (Ollama); anything else is a cloud
 * provider id, shown as-is (no hardcoded provider-name table, mirrors the
 * backend's own "do not hardcode a provider code table" rule, 1.1). */
function providerLabel(provider: string): string {
  return provider === "local" ? "Ollama local" : provider;
}

type TurnKind = "chat" | "alert";

interface Turn {
  id: string;
  kind: TurnKind;
  /** Marks a turn as Kira-authored (the transient "thinking" indicator or a
   * real accumulated reply) so ConversationTurn can distinguish it from an
   * operator bubble without relying on a magic id string. */
  role?: "operator" | "kira";
  /** Present for operator-submitted turns and accumulated Kira replies. */
  text?: string;
  /** Sort key interleaving the independent chat/agenda/app-event streams. The
   * REAL event time wherever a server clock exists — Kira's reply carries
   * `ts` on GET /api/chat/last-reply, server app-events carry theirs through
   * src/api/events.ts, and a voice turn borrows the engine's own `ptt.*` echo.
   * Client arrival time only where nothing better is available (agenda diffs,
   * operator composer sends — which ARE local actions, so arrival IS the truth). */
  ts?: number;
  /** True when this Kira reply came from an autonomous agenda turn
   * (last-reply `source` startsWith "kira-agenda") rather than a reply to
   * operator/viewer chat — drives a distinct KIRA · AGENDA label. */
  fromAgenda?: boolean;
  /** Marks an operator turn that arrived by voice (PTT hold echoed from
   * LiveAudio's transcript WS) rather than the composer — drives the
   * "Vos · voz" label above the bubble. */
  source?: "voice";
  /** Unit 4.2 (runtime_findings_batch_20260731, D3b/F12): how long this reply
   * sat queued before the engine dequeued it (GET /api/chat/last-reply
   * `queue_wait_ms`), and which provider actually answered. Undefined/null
   * for any turn with no submitted_under_provider tag (agenda, accumulated,
   * or the transient "pensando" sentinel) — never a fabricated value. */
  queueWaitMs?: number | null;
  answeredByProvider?: string | null;
  providerChanged?: boolean | null;
  /** D3b receipt: overrides the generic "Kira está pensando…" copy on the
   * transient thinking row while the engine is busy with other work — direct
   * chat never interrupts (D3), so this is honest about WHEN she'll answer. */
  pendingNote?: string;
  /** Agenda lifecycle / app-event copy (kind:"alert"). Rendered as a full-width
   * Alert (following the operator's chosen alert style), not a chat bubble. */
  event?: string;
  /** Tone the app-event carries (agenda events have none → neutral). Drives the
   * event line's Alert tone. */
  tone?: AppEventTone;
}

function matchesTab(tab: TabValue, kind: TurnKind): boolean {
  if (tab === "chat") return kind === "chat";
  if (tab === "alertas") return kind === "alert";
  return true; // "todo" (non-feed tabs hide the timeline anyway)
}

// ONE formatter for the module — same reason LogsPanel hoists TS_FORMAT
// (src/features/experiencia/LogsPanel.tsx): Date#toLocaleTimeString builds a
// fresh locale formatter on every call, and this one is paid per ROW on every
// parent render. Hour+minute only; the feed is a cockpit, LogsPanel is the log
// viewer and keeps the seconds.
const TURN_TIME_FORMAT = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });

interface TurnTimeProps {
  ts?: number;
  className?: string;
}

/** Quiet per-row wall clock. Without it a five-minute-old backlogged event is
 * visually indistinguishable from a fresh one — which is how an out-of-order
 * feed hides. Metadata only: a time, never a payload value. */
function TurnTime({ ts, className = "" }: TurnTimeProps) {
  if (ts === undefined) return null;
  return (
    <time dateTime={new Date(ts).toISOString()} className={`mono shrink-0 text-[10px] font-normal tabular-nums text-dim ${className}`.trim()}>
      {TURN_TIME_FORMAT.format(ts)}
    </time>
  );
}

function KiraBadgeLabel({ fromAgenda = false }: { fromAgenda?: boolean }) {
  return (
    <span className="mono inline-flex w-fit items-center gap-[6px] text-[11px] font-semibold tracking-[0.06em] text-[var(--kira-cyan)]">
      <KiraFace size={22} aria-hidden />
      {fromAgenda ? "KIRA · AGENDA" : "KIRA"}
    </span>
  );
}

function ConversationTurnImpl({ turn }: { turn: Turn }) {
  if (turn.role === "kira" && turn.text === undefined) {
    return (
      <div className="flex flex-col gap-1.5">
        <KiraBadgeLabel />
        <p className="w-full animate-pulse rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm italic text-dim">
          {turn.pendingNote ?? "Kira está pensando…"}
        </p>
      </div>
    );
  }

  if (turn.role === "kira") {
    // Unit 4.2 (D3b/F12): a subtle meta line — queue wait and/or the
    // answering provider — under the timestamp. Skipped entirely for an
    // untagged turn (agenda/accumulated) and for a genuinely instant (0ms)
    // reply, which would otherwise print a noisy "esperó 0 s en cola".
    const hasWaitNote = turn.queueWaitMs != null && turn.queueWaitMs > 0;
    const hasProviderNote = Boolean(turn.answeredByProvider);
    // Kira's reply is LLM markdown — render it formatted (bold, code, tables,
    // lists, links). min-w-0 + the bubble's max-w keep long code/tables scrolling
    // inside the bubble instead of widening the panel. A <div> (not <p>) because
    // markdown emits block elements (<pre>, <table>) that can't nest in a <p>.
    return (
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <KiraBadgeLabel fromAgenda={turn.fromAgenda} />
          <TurnTime ts={turn.ts}/>
        </span>
        <div className="w-full min-w-0 rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-foreground">
          <Markdown content={turn.text ?? ""} />
        </div>
        {(hasWaitNote || hasProviderNote) && (
          <p className="mono text-[10px] text-dim">
            {hasWaitNote && `esperó ${formatQueueWaitLabel(turn.queueWaitMs as number)} en cola`}
            {hasWaitNote && hasProviderNote && " · "}
            {hasProviderNote && providerLabel(turn.answeredByProvider as string)}
            {turn.providerChanged ? " (cambió de proveedor en cola)" : ""}
          </p>
        )}
      </div>
    );
  }

  if (turn.text !== undefined) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="flex items-center gap-2">
          {turn.source === "voice" ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-dim">
              <Mic size={11} aria-hidden="true" />
              Vos · voz
            </span>
          ) : (
            <span className="text-[11px] font-semibold text-dim">Vos</span>
          )}
          <TurnTime ts={turn.ts} />
        </span>
        {/* text-[15px] + leading-relaxed: same legibility bump as Kira's
            Markdown bubble; break-words so a pasted long token can't widen it. */}
        <p className="w-full break-words rounded-md rounded-tr-sm border border-ok-bd bg-ok-bg px-3 py-2 text-[15px] leading-relaxed text-foreground">
          {turn.text}
        </p>
      </div>
    );
  }

  // Agenda lifecycle / operator-action event line. Full-width Alert (not a
  // centered meta chip) so it reads as a timeline entry and follows the
  // operator's chosen alert style (sereno/marcado/contorno), same as every
  // other Alert. role="status" (not "alert") so these historical lines announce
  // on arrival without INTERRUPTING the screen reader the way a live send-error
  // does. Tone reuses whatever the event carries (agenda events → neutral). The
  // label text is owned upstream (appEvents.ts / agenda.ts) and is not edited
  // here. rise-in entry is provided by the .oc-alert base rule itself.
  // The stamp sits OUTSIDE the Alert, not inside its body: `oc-alert-body` is a
  // single <p>, so a nested <time> would fold into that element's text content
  // and every exact-match assertion on an event label would start matching
  // "Modelo → qwen3:8b 14:05" instead.
  if (turn.event !== undefined) {
    return (
      <div className="flex flex-row items-center justify-between gap-2">
        <Alert tone={turn.tone ?? "neutral"} role="status" className="min-w-0 flex-1 gap-1">
          {turn.event}
          {/* Necesita separarse use ml-auto y solo pl-3 funciona pero no es el resultado esperado debe estar la hora un efecto similar a justify-end*/}
          <TurnTime ts={turn.ts} className="ml-auto pl-3"/>
        </Alert>
      </div>
    );
  }

  return null;
}

/** Memoized for the same reason Markdown is (src/ui/Markdown.tsx —
 * the in-repo pattern): every row was re-rendered on every parent render, and
 * the parent re-renders on four polls plus every keystroke. `turn` objects are
 * stable across renders now that visibleTurns is memoized, so this actually
 * bails out instead of just adding a comparison. */
const ConversationTurn = memo(ConversationTurnImpl);

/** <aside> queue region — the real POST /api/chat/turn composer (useSendChatTurn)
 * plus Kira's accumulated last-reply turns and interleaved agenda/app events.
 * The operator's own message is appended locally as an ephemeral turn so it's
 * visible immediately; there's no server echo to reconcile against. */
export function ConversationPanel() {
  // ONE unified tab strip (owner layout correction 2026-07-18): todo/chat/alertas
  // are feed filters; comandos and logs swap the panel. Default: the Todo feed.
  const [activeTab, setActiveTab] = useState<TabValue>("todo");
  // Command launched from the emergent composer popover, opened in the Comandos
  // tab. Controlled here so re-launching the SAME command reopens it there.
  const [comandoId, setComandoId] = useState<string | null>(null);
  // R36 flagged assumption: this preference gates Logs-TAB VISIBILITY, not a
  // "jump to Logs" shortcut — owner sign-off pending, see spec.md R36.
  const { showLogs } = useLogsPref();
  // Unread indicator for the Logs tab (D10/R7): ephemeral, session-only.
  const [seenLogId, setSeenLogId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  // Composer command palette (mockup): a live, prefix-based detection — the
  // panel shows whenever the trimmed composer value starts with "/" or "!".
  const composerRef = useRef<HTMLDivElement>(null);
  const showCommandPanel = /^[/!]/.test(message.trim());
  // F1: the popover only renders an actual `role="listbox"` when at least one
  // command matches (zero matches shows the "comando desconocido" status hint
  // instead, no listbox) — the input's combobox expanded/controls state must
  // follow that reality, not just the raw "/"|"!" prefix. Derived straight from
  // the same registry the popover itself filters through — no extra plumbing.
  const commandListboxOpen = showCommandPanel && matchCommands(message).length > 0;
  // F3: the composer input's aria-activedescendant follows the popover's
  // keyboard-highlighted option (combobox pattern).
  const [activeDescendant, setActiveDescendant] = useState<string | null>(null);
  // Session-local transcript: operator turns (appended on successful send)
  // interleaved with accumulated Kira replies (appended as new turn_ids land
  // on the last-reply poll). This is the fix for the "each new reply erases
  // the previous one" bug — the old implementation only ever kept ONE Kira
  // turn around, replacing it on every poll instead of accumulating.
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const { send, pending, isError, error } = useSendChatTurn();
  const lastReply = useLastReply();
  // D3b receipt: while the engine is busy (speaking/processing — most often
  // an agenda block), a direct question does NOT interrupt (D3) — it answers
  // on the next turn boundary. Reused below to swap the generic "pensando"
  // copy for an honest "responderá después del bloque actual".
  const status = useStatusQuery();
  const kiraBusy = Boolean(status.data?.is_speaking || status.data?.is_processing);
  // Autonomous agenda lifecycle events (topic activated/changed/finished/
  // paused, turns spoken) diffed from the agenda poll — interleaved into the
  // stream below as alert meta chips, filtered by the Alertas tab.
  const agendaEvents = useAgendaEvents();
  // Operator-action metadata events (model/profile/music/obs/stream/ptt —
  // src/lib/appEvents.ts's whitelist is the only source of these labels)
  // interleaved into the stream the same way agenda events already are.
  const appEvents = useEventStore(selectEvents);
  // Logs unread dot (D10/R7): lit when the newest event is unseen and we're not
  // already looking at Logs; cleared once Logs is active AND has rendered.
  const latestLogId = appEvents.length > 0 ? appEvents[appEvents.length - 1].id : null;
  const unreadLogs = showLogs && latestLogId !== null && latestLogId !== seenLogId && activeTab !== "logs";
  // Tracks the operator bubble for the in-flight/retryable send intent, so a
  // retry after a failed send updates that SAME bubble instead of appending
  // a duplicate "Vos" turn. Cleared once the send succeeds.
  const pendingTurnIdRef = useRef<string | null>(null);
  // The highest Kira turn_id already appended to the transcript. Starts at 0
  // to match the backend's own "no reply yet" sentinel (ChatReplySink.last(),
  // opencohost/api/engine_host.py) — turn_id 0 with text: null must never
  // create a phantom entry, and re-polling the SAME turn_id must never
  // duplicate the entry that's already in the transcript.
  const lastRecordedTurnIdRef = useRef(0);
  // True from a successful send until a GENUINE new reply lands. Gating this
  // on a plain "baseline turn_id" breaks when useLastReply hasn't resolved
  // yet at submit time (baseline would be null, so pending clearing alone
  // would immediately read as "no new reply" and drop the indicator). So we
  // track "waiting" as its own flag and only capture the baseline turn_id
  // once useLastReply actually resolves — the first resolution just anchors
  // the baseline, only a LATER change away from it counts as the real reply.
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [awaitingBaseline, setAwaitingBaseline] = useState<number | null>(null);
  const currentTurnId = lastReply.data?.turn_id ?? null;

  // Composer mic — the SAME usePttHold hook PTTCard drives, relocated here as
  // a hold-to-talk affordance. Pointer + button-local key events ONLY: PTTCard
  // owns the window-level global gesture when mounted, so adding a second set
  // of window listeners here would double-start the single-slot session.
  const { state: pttState, error: pttError, start: pttStart, stop: pttStop } = usePttHold();
  // No proactive STT-availability signal exists (see §3b(iv) of the design
  // doc / PRIVACY note in ptt.ts): unavailability only surfaces as a 503 on
  // start. After the first stt_unreachable we degrade the mic (MicOff, dimmed)
  // until a later press succeeds.
  const [micDegraded, setMicDegraded] = useState(false);
  // Confirms the SEND (not the reply): shown for 4s on the flushing -> idle
  // transition. Kira's reply lands in the transcript via useLastReply anyway.
  const [voiceSent, setVoiceSent] = useState(false);
  const prevPttStateRef = useRef<PttUiState>(pttState);

  // Transcript echo: while a hold is active (this composer's mic OR the
  // external F10 bridge — both surface on the polled /api/ptt/state), the
  // hook consumes LiveAudio's broadcast WS directly and resolves the spoken
  // text once the backend flushes. PRIVACY: the words arrive over LiveAudio's
  // own socket, never the OpenCohost HTTP API. Empty/failed echo -> the hook
  // never fires -> no turn, no alert spam.
  useLiveTranscript((text, pttStamp) => {
    // The spoken WORDS never cross the OpenCohost HTTP API (privacy design), so
    // there is no server timestamp for the transcript itself — and its arrival
    // time is the flushing->idle observation, minutes late when the window is
    // backgrounded. But the HOLD's lifecycle does cross: the engine emits
    // `ptt.started`/`ptt.stopped`, and src/api/events.ts carries their REAL
    // server ts into the event store. The hook resolves which of those readings
    // belongs to THIS hold (per-hold baseline, see useLiveTranscript) and hands
    // it over as `pttStamp`, or 0 when the hold produced none. A reading that
    // belongs to the hold was taken before the grace window that dispatches the
    // turn, so it is strictly before the reply's own server ts — that is what
    // keeps the bubble above the answer it caused. 0 means arrival time, which
    // is honest and sorts last; it never re-borrows another hold's reading.
    const now = Date.now();
    const ts = pttStamp > 0 ? Math.min(pttStamp, now) : now;
    setTranscript((turns) =>
      capTurns([...turns, { id: `voice-${crypto.randomUUID()}`, kind: "chat", role: "operator", source: "voice", text, ts }])
    );
  });

  // Timeline scroll-follow + jump-to-recent (Item 3). scrollRef is the existing
  // overflow-auto tabpanel.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Id of the last REAL row (see lastTurnId below). This ALONE tells a genuine
  // append-at-the-end apart from a middle backfill and from a plain re-render —
  // the row count it used to be paired with could answer neither at
  // TRANSCRIPT_CAP (every arrival evicts one, so the count freezes) nor when a
  // reply replaces the thinking row (2 -> 2 in one flush).
  const prevLastTurnIdRef = useRef<string | null>(null);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    if (!awaitingReply) return;
    if (awaitingBaseline === null) {
      if (currentTurnId !== null) setAwaitingBaseline(currentTurnId);
      return;
    }
    if (currentTurnId !== awaitingBaseline) {
      setAwaitingReply(false);
      setAwaitingBaseline(null);
    }
  }, [awaitingReply, awaitingBaseline, currentTurnId]);

  // Accumulates a new Kira transcript entry the moment a NEW turn_id with
  // real text lands on the poll. Dedup is strict: a turn_id already appended
  // (including the initial 0/null-text sentinel) is never appended again, so
  // repeated polls of the same reply are a no-op.
  useEffect(() => {
    const data = lastReply.data;
    if (!data || !data.text) return;
    if (data.turn_id <= 0 || data.turn_id === lastRecordedTurnIdRef.current) return;
    if (data.turn_id < lastRecordedTurnIdRef.current) {
      // The backend's turn_id counter resets to a low number on restart. A
      // turn_id lower than the highest one we've already recorded means the
      // reply we just polled is stale from the NEW process's perspective —
      // resync the ref without appending, so a genuinely new reply (which
      // will land with a higher turn_id relative to this new baseline)
      // appends normally instead of being skipped or duplicated.
      lastRecordedTurnIdRef.current = data.turn_id;
      return;
    }
    lastRecordedTurnIdRef.current = data.turn_id;
    const id = `kira-reply-${data.turn_id}`;
    // R8/source (llm_engine.py): a reply whose source starts with
    // "kira-agenda" is an autonomous agenda turn, not a reply to operator/
    // viewer chat — tag it so ConversationTurn labels it distinctly.
    const fromAgenda = data.source?.startsWith("kira-agenda") ?? false;
    // The backend ALREADY stamps this reply: ChatReplySink.record() stores
    // `ts: time.time()` (opencohost/api/engine_host.py), surfaced through
    // ChatLastReplyResponse (models.py) as LastReplyResponse.ts here. Arrival
    // time was throwing that away, so a reply polled late — backgrounded
    // window, or several polls catching up in one burst — sorted by WHEN THE
    // WEBVIEW NOTICED rather than when Kira spoke, above the turn that caused
    // it. Seconds -> ms; `null` (no reply yet / older backend) keeps arrival
    // time as the honest fallback.
    const ts = typeof data.ts === "number" ? data.ts * 1000 : Date.now();
    // Unit 4.2 (D3b/F12): carried straight from ChatLastReplyResponse — null
    // for any turn with no submitted_under_provider tag (agenda, accumulated,
    // or a reply recorded before this unit), never a fabricated value.
    const queueWaitMs = data.queue_wait_ms ?? null;
    const answeredByProvider = data.answered_by_provider ?? null;
    const providerChanged = data.provider_changed_while_queued ?? null;
    setTranscript((turns) => {
      // Belt-and-braces guard against any other path producing a collision.
      if (turns.some((turn) => turn.id === id)) return turns;
      return capTurns([
        ...turns,
        { id, kind: "chat", role: "kira", text: data.text as string, fromAgenda, ts, queueWaitMs, answeredByProvider, providerChanged }
      ]);
    });
  }, [lastReply.data]);

  // Mic degrades on the first stt_unreachable and un-degrades once a press
  // actually reaches "listening" again.
  useEffect(() => {
    if (pttError === "stt_unreachable") setMicDegraded(true);
  }, [pttError]);
  useEffect(() => {
    if (pttState === "listening") setMicDegraded(false);
  }, [pttState]);

  // Clear the Logs unread dot once the operator is viewing Logs and the newest
  // event has rendered (R7 clear-on-view, not clear-on-click).
  useEffect(() => {
    if (activeTab === "logs") setSeenLogId(latestLogId);
  }, [activeTab, latestLogId]);

  // If the pref is turned OFF while Logs is active, fall back to the Todo feed
  // so the strip never points at a tab that no longer exists.
  useEffect(() => {
    if (!showLogs && activeTab === "logs") setActiveTab("todo");
  }, [showLogs, activeTab]);

  // "Turno de voz enviado" confirmation: fire on the flushing -> idle
  // transition with no error, auto-clear after 4s.
  useEffect(() => {
    const prev = prevPttStateRef.current;
    prevPttStateRef.current = pttState;
    if (prev === "flushing" && pttState === "idle" && pttError === null) {
      setVoiceSent(true);
      const timer = setTimeout(() => setVoiceSent(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [pttState, pttError]);

  const isThinking = pending || awaitingReply;

  function handleMessageChange(event: ChangeEvent<HTMLInputElement>) {
    setMessage(event.target.value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // block concurrent submits (e.g. rapid Enter presses)
    const text = message.trim();
    if (!text) return;
    // Slash/bang commands are owned by the command palette (mockup), never sent
    // as a chat turn. A normal message (no "/"/"!" prefix) submits as before.
    if (showCommandPanel) return;

    const turnId = pendingTurnIdRef.current ?? crypto.randomUUID();
    pendingTurnIdRef.current = turnId;
    setTranscript((turns) => {
      const existingIndex = turns.findIndex((turn) => turn.id === turnId);
      if (existingIndex === -1) return capTurns([...turns, { id: turnId, kind: "chat", role: "operator", text, ts: Date.now() }]);
      const next = [...turns];
      next[existingIndex] = { ...next[existingIndex], text };
      return next;
    });

    try {
      await send(text);
      setMessage("");
      pendingTurnIdRef.current = null;
      setAwaitingReply(true);
      setAwaitingBaseline(currentTurnId);
    } catch {
      // isError/error below already carry this reactively — the message
      // stays in the input so the operator can retry without retyping it.
      // pendingTurnIdRef stays set so that retry reuses (and updates) the
      // same bubble instead of appending a duplicate.
    }
  }

  function handleMicPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId); // guarantees the up event even off-button; optional-chained for jsdom
    pttStart();
  }

  function handleMicKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.repeat) return;
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault(); // suppress the button's own native space-triggers-click
    pttStart();
  }

  function handleMicKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    pttStop();
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    // Optional-chained: jsdom has no scrollTo, the real WebView2 shell does.
    el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    setShowJump(false);
  }

  // Show the jump pill whenever the operator is scrolled up past the threshold
  // (independent of new arrivals — that's the owner's fix), hide it once they're
  // back near the bottom.
  //
  // rAF-throttled: the follow effect below scrolls with behavior:"smooth" (the
  // owner's "ir lentamente bajando"), and a smooth scroll emits a scroll event
  // on EVERY frame of its animation. Each one used to force three synchronous
  // layout reads inline, so one append could cost dozens of reflows. Coalescing
  // to at most one read per frame — taken inside the frame callback, after
  // layout, instead of mid-event — removes the storm without changing behavior
  // or dropping the smooth scroll the owner asked for.
  const scrollRafRef = useRef<number | null>(null);
  const handleTimelineScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return; // a read is already queued for this frame
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
      setShowJump(!nearBottom);
    });
  }, []);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    },
    []
  );

  // ONE memoized pass over the whole history. This used to run
  // map -> map -> spread -> sort -> filter across the entire timeline on EVERY
  // render — and renders here are driven by four independent polls (status,
  // chat last-reply, agenda, engine events) plus every composer keystroke, PTT
  // state change and toast timer. Keyed on its real inputs, so typing a message
  // no longer re-sorts the stream, and the resulting array identity is stable
  // enough for the memoized ConversationTurn rows below to actually bail out.
  const visibleTurns = useMemo(() => {
    const agendaTurns: Turn[] = agendaEvents.map((event) => ({
      id: event.id,
      kind: "alert",
      event: event.label,
      ts: event.ts
    }));
    const appEventTurns: Turn[] = appEvents.map((event) => ({
      id: event.id,
      kind: "alert",
      event: event.label,
      tone: event.tone,
      ts: event.ts
    }));
    // The real stream: operator sends, Kira replies, and agenda/app events
    // interleaved by client arrival time (Date.now() at observe-time), then the
    // ephemeral "pensando" indicator closes it out.
    const interleaved = [...transcript, ...agendaTurns, ...appEventTurns].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    const kiraThinkingTurn: Turn | null = isThinking
      ? {
          id: KIRA_THINKING_ID,
          kind: "chat",
          role: "kira",
          // D3b: direct chat never interrupts — Kira finishes the current
          // block and answers on the NEXT turn (D3). Honest receipt for that
          // wait instead of implying she's generating THIS answer right now.
          pendingNote: kiraBusy ? "Kira te escuchó — responderá después del bloque actual" : undefined
        }
      : null;
    const orderedTurns = [...interleaved, ...(kiraThinkingTurn ? [kiraThinkingTurn] : [])];
    return orderedTurns.filter((turn) => matchesTab(activeTab, turn.kind));
  }, [transcript, agendaEvents, appEvents, isThinking, activeTab, kiraBusy]);

  // Identity of the last CONTENT row. The "pensando" sentinel is always last
  // while it exists (it is appended after the sort), so skipping it is one index
  // step — and it must be skipped, or its whole multi-second window reads as
  // "nothing arrived at the end".
  const lastRow = visibleTurns[visibleTurns.length - 1];
  const lastTurnId =
    (lastRow?.id === KIRA_THINKING_ID ? visibleTurns[visibleTurns.length - 2]?.id : lastRow?.id) ?? null;

  // On a genuine append AT THE END: follow the bottom if the operator is already
  // near it (behavior:'smooth', "ir lentamente bajando"); otherwise don't yank —
  // surface the floating jump-to-recent button. Pure scrollTop math on the
  // existing container (jsdom-testable; no IntersectionObserver).
  //
  // A change of this ONE id is the whole condition, and it answers all five
  // cases: ordinary append -> scroll; backfilled batch (an event or a reply
  // carrying an older real timestamp) sorting into the MIDDLE -> the bottom row
  // is unchanged, so no yank away from whatever the operator was reading;
  // append during the "pensando" window -> scroll (the sentinel is skipped);
  // append at TRANSCRIPT_CAP, where the count can no longer grow because every
  // arrival evicts one -> scroll; plain re-render -> nothing changed, no scroll.
  // The row count that used to gate this was doing the "is it a real append"
  // job WRONG in the last two of those, so it is gone rather than kept as a
  // second opinion.
  useEffect(() => {
    const el = scrollRef.current;
    // A null id means the list has no content rows (a filter switch emptied it) —
    // that is not an append.
    const appendedLast = lastTurnId !== null && lastTurnId !== prevLastTurnIdRef.current;
    prevLastTurnIdRef.current = lastTurnId;
    if (!el || !appendedLast) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX) {
      el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      setShowJump(true);
    }
  }, [lastTurnId]);

  // Empty-state rule (§3b(i), revision #4): the invitation shows on Todo/Chat
  // whenever there are ZERO chat-kind turns (no transcript turns, no thinking
  // indicator), REGARDLESS of alert-kind event lines — motor.* events land
  // within seconds of startup and must not kill the invitation. Alertas keeps
  // its own "Sin turnos en este filtro." empty case.
  const hasChatKindTurns = transcript.length > 0 || isThinking;
  const showEmptyState = activeTab !== "alertas" && !hasChatKindTurns;

  const micLabel =
    pttState === "connecting"
      ? "Conectando…"
      : pttState === "listening"
        ? "Escuchando… soltá para enviar"
        : pttState === "flushing"
          ? "Procesando…"
          : "Mantené para hablar con Kira";
  const showMicOff = micDegraded && pttState === "idle";
  const MicGlyph = showMicOff ? MicOff : Mic;

  // Todo/Chat/Alertas show the feed (timeline + composer); Comandos/Logs swap
  // the panel. The feed region stays MOUNTED (hidden + inert) when a non-feed
  // tab is active so the timeline scroll survives (R6); the composer, though, is
  // unmounted so it truly leaves the a11y tree and no "/" palette is reachable
  // from it (R8).
  const feedActive = activeTab === "todo" || activeTab === "chat" || activeTab === "alertas";
  const feedTabId = FEED_TAB_ID[feedActive ? (activeTab as "todo" | "chat" | "alertas") : "todo"];

  // min-w-0 on the aside: it is a grid item, so its automatic min size is
  // min-content — one wide Kira table/code reply used to force it past the
  // fixed 465px chat column and break the whole app layout (runtime session
  // 2026-08-07, 15:40). With the floor at 0 the column holds and the
  // table/pre overflow-x-auto wrappers in Markdown.tsx do the scrolling.
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-border-soft bg-card">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)} className="flex min-h-0 flex-1 flex-col">
        {/* ONE unified strip (owner layout correction 2026-07-18): Todo/Chat/
            Alertas filter the timeline (they share the single "conversation-panel"
            via a fixed id/aria-controls); Comandos and Logs swap the panel. */}
        <TabList ariaLabel="Conversación" className="flex gap-1 border-b border-border-soft px-3 py-2">
          <Tab value="todo" id={FEED_TAB_ID.todo} controls="conversation-panel" className={tabClass(activeTab === "todo")}>Todo</Tab>
          <Tab value="chat" id={FEED_TAB_ID.chat} controls="conversation-panel" className={tabClass(activeTab === "chat")}>Chat</Tab>
          <Tab value="comandos" className={tabClass(activeTab === "comandos")}>Comandos</Tab>
          <Tab value="alertas" id={FEED_TAB_ID.alertas} controls="conversation-panel" className={tabClass(activeTab === "alertas")}>Alertas</Tab>
          {showLogs && (
            <Tab value="logs" className={cn(tabClass(activeTab === "logs"), "relative")}>
              Logs
              {unreadLogs && (
                <span
                  aria-hidden="true"
                  data-unread
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle"
                />
              )}
            </Tab>
          )}
        </TabList>

        {/* Feed region — shown for Todo/Chat/Alertas, kept MOUNTED (hidden +
            inert + aria-hidden) on Comandos/Logs so the timeline scroll survives
            (R6). It is NOT a <TabPanel> because three filter tabs share it. */}
        <div
          hidden={!feedActive}
          inert={!feedActive ? "" : undefined}
          aria-hidden={!feedActive}
          style={!feedActive ? { display: "none" } : undefined}
          className={cn("flex min-h-0 flex-1 flex-col", !feedActive && "pointer-events-none")}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <span className="mono text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Conversación</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-ok">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                {/* <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" /> */}
                {/* <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" /> */}
              </span>
              {/* sesión en vivo */}
            </span>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              role="tabpanel"
              id="conversation-panel"
              tabIndex={0}
              ref={scrollRef}
              onScroll={handleTimelineScroll}
              aria-labelledby={feedTabId}
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {visibleTurns.map((turn) => (
                <ConversationTurn key={turn.id} turn={turn} />
              ))}
              {showEmptyState && (
                <div className="m-auto flex flex-col items-center gap-2 py-8 text-center animate-rise-in">
                  <KiraFace size={40} aria-hidden />
                  <p className="text-sm font-semibold text-foreground">Empezá a chatear con Kira</p>
                  <p className="max-w-[220px] text-xs text-muted-foreground">
                    Escribí un mensaje abajo, o mantené el micrófono para hablarle.
                  </p>
                </div>
              )}
              {activeTab === "alertas" && visibleTurns.length === 0 && (
                <p className="text-xs text-dim">Sin turnos en este filtro.</p>
              )}
            </div>
            {showJump && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-2 right-4 z-10 inline-flex -translate-x-1/2 items-center gap-3.5 rounded-full border border-border-soft bg-card px-3 py-2.5 text-xs font-semibold text-foreground shadow-panel animate-rise-in transition-colors duration-fast ease-io focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ChevronDown size={14} aria-hidden="true" />
                Ver lo más reciente
              </button>
            )}
          </div>

          {feedActive && (
            <div ref={composerRef} className="relative border-t border-border-soft bg-surface-2 p-3">
              {/* Emergent command launcher (owner layout correction 2026-07-18):
                  appears above the composer only while the input starts with
                  "/"|"!"; selecting a command routes it to the Comandos tab. */}
              {showCommandPanel && (
                <CommandPalettePopover
                  query={message}
                  composerRef={composerRef}
                  onActiveDescendantChange={setActiveDescendant}
                  onSelect={(id) => {
                    setComandoId(id);
                    setActiveTab("comandos");
                    setMessage("");
                  }}
                  onClose={() => {
                    setMessage("");
                    // Restore focus to the composer input the operator was typing in.
                    composerRef.current?.querySelector("input")?.focus();
                  }}
                />
              )}
              <div
                className="mono flex h-7 items-center gap-2 text-[11px] text-dim"
                title="Kira no está leyendo el chat de viewers en esta sesión."
              >
                <MessageSquareOff size={12} aria-hidden="true" />
                Chat de viewers silenciado
              </div>

              {voiceSent && (
                <p role="status" className="mono mt-1 flex items-center gap-1.5 text-[11px] text-dim animate-rise-in">
                  <Mic size={12} aria-hidden="true" />
                  Turno de voz enviado
                </p>
              )}
              {/* role="alert" (assertive) + icon + rise-in: a live PTT failure must
                  actually register — the old bare 11px line was easy to miss. */}
              {pttError && (
                <p role="alert" className="mono mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-danger animate-rise-in">
                  <MicOff size={12} aria-hidden="true" />
                  {ERROR_COPY[pttError]}
                </p>
              )}

              <form onSubmit={handleSubmit} className="mt-2">
                <Input
                  type="text"
                  value={message}
                  onChange={handleMessageChange}
                  placeholder="Escribí un mensaje para Kira…"
                  aria-label="Mensaje para Kira"
                  // F3: combobox pattern — the launcher popover is this input's
                  // listbox; aria-activedescendant follows its keyboard highlight.
                  role="combobox"
                  aria-expanded={commandListboxOpen}
                  aria-controls={commandListboxOpen ? COMMAND_PALETTE_LISTBOX_ID : undefined}
                  aria-activedescendant={commandListboxOpen ? (activeDescendant ?? undefined) : undefined}
                  trailing={
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        aria-label={micLabel}
                        aria-pressed={pttState === "listening"}
                        title={showMicOff ? "PTT no disponible — WhisperLive no está corriendo." : undefined}
                        onPointerDown={handleMicPointerDown}
                        onPointerUp={pttStop}
                        onPointerCancel={pttStop}
                        onLostPointerCapture={pttStop}
                        onKeyDown={handleMicKeyDown}
                        onKeyUp={handleMicKeyUp}
                        className={cn(
                          "relative flex h-full w-10 touch-none select-none items-center justify-center overflow-hidden transition-colors duration-fast",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          pttState === "idle" && !micDegraded && "text-muted-foreground hover:text-foreground",
                          showMicOff && "text-muted-foreground opacity-60",
                          // connecting: tint the whole button, not just the 16px
                          // glyph — same treatment family as the listening wash.
                          pttState === "connecting" && "bg-info-bg text-info animate-pulse",
                          pttState === "listening" && "bg-danger-bg text-danger animate-pulse",
                          pttState === "flushing" && "text-muted-foreground animate-pulse"
                        )}
                      >
                        {/* Hold-fill: rises while listening, drains fast on release.
                            Pure visual (aria-hidden); state is carried by aria-pressed. */}
                        <span
                          aria-hidden="true"
                          className={cn("mic-fill pointer-events-none absolute inset-0", pttState === "listening" && "mic-fill--filling")}
                        />
                        <MicGlyph size={16} aria-hidden="true" className="relative z-[1]" />
                      </button>
                      <button
                        type="submit"
                        disabled={pending}
                        className="flex items-center px-4 text-sm font-semibold bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] transition-opacity disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Enviar
                      </button>
                    </div>
                  }
                />
              </form>
            </div>
          )}

          {isError && feedActive && (
            <div className="px-3 pb-3">
              <Alert tone="danger">{error?.message ?? "No se pudo enviar el mensaje."}</Alert>
            </div>
          )}
        </div>

        <TabPanel value="comandos" className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
          {/* R9: same COMMANDS registry as the launcher, rendered inline (no
              floating dialog). It is the browsable home; the launcher opens a
              command here via the controlled activeId. `visible` gates its Escape
              handler so, while hidden, it never swallows the launcher's Escape. */}
          <ComposerCommandPanel
            inline
            query=""
            activeId={comandoId}
            onActiveIdChange={setComandoId}
            visible={activeTab === "comandos"}
            onClose={() => setActiveTab("todo")}
          />
        </TabPanel>

        {showLogs && (
          <TabPanel value="logs" className="flex min-h-0 flex-1 flex-col overflow-auto p-3">
            <LogsPanel />
          </TabPanel>
        )}
      </Tabs>
    </aside>
  );
}
