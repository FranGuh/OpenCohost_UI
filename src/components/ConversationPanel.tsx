import { useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { ChevronDown, MessageSquareOff, Mic, MicOff } from "lucide-react";
import { Alert } from "./ui/Alert.js";
import { COMMAND_PALETTE_LISTBOX_ID, CommandPalettePopover, ComposerCommandPanel } from "./ComposerCommandPanel.js";
import { Input } from "./ui/Input.js";
import { KiraFace } from "./ui/KiraFace.js";
import { Markdown } from "./ui/Markdown.js";
import { Tab, TabList, TabPanel, Tabs } from "./ui/Tabs.js";
import { matchCommands } from "./commands/registry.js";
import { LogsPanel } from "./commands/LogsPanel.js";
import { useLogsPref } from "../store/useLogsPref.js";
import { useAgendaEvents } from "../api/agenda.js";
import { useLastReply, useSendChatTurn } from "../api/chat.js";
import { useLiveTranscript } from "../api/liveTranscript.js";
import { usePttHold, type PttUiState } from "../api/ptt.js";
import { ERROR_COPY } from "../api/pttCopy.js";
import { cn } from "../lib/cn.js";
import { selectEvents, useEventStore, type AppEventTone } from "../store/eventStore.js";

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
  /** Client arrival time (Date.now() at observe/append time) used to
   * interleave the independent chat/agenda/app-event streams deterministically. */
  ts?: number;
  /** True when this Kira reply came from an autonomous agenda turn
   * (last-reply `source` startsWith "kira-agenda") rather than a reply to
   * operator/viewer chat — drives a distinct KIRA · AGENDA label. */
  fromAgenda?: boolean;
  /** Marks an operator turn that arrived by voice (PTT hold echoed from
   * LiveAudio's transcript WS) rather than the composer — drives the
   * "Vos · voz" label above the bubble. */
  source?: "voice";
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

function KiraBadgeLabel({ fromAgenda = false }: { fromAgenda?: boolean }) {
  return (
    <span className="mono inline-flex w-fit items-center gap-[6px] text-[11px] font-semibold tracking-[0.06em] text-[var(--kira-cyan)]">
      <KiraFace size={22} aria-hidden />
      {fromAgenda ? "KIRA · AGENDA" : "KIRA"}
    </span>
  );
}

function ConversationTurn({ turn }: { turn: Turn }) {
  if (turn.role === "kira" && turn.text === undefined) {
    return (
      <div className="flex flex-col gap-1.5">
        <KiraBadgeLabel />
        <p className="w-full animate-pulse rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm italic text-dim">
          Kira está pensando…
        </p>
      </div>
    );
  }

  if (turn.role === "kira") {
    // Kira's reply is LLM markdown — render it formatted (bold, code, tables,
    // lists, links). min-w-0 + the bubble's max-w keep long code/tables scrolling
    // inside the bubble instead of widening the panel. A <div> (not <p>) because
    // markdown emits block elements (<pre>, <table>) that can't nest in a <p>.
    return (
      <div className="flex flex-col gap-1.5">
        <KiraBadgeLabel fromAgenda={turn.fromAgenda} />
        <div className="w-full min-w-0 rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm text-foreground">
          <Markdown content={turn.text ?? ""} />
        </div>
      </div>
    );
  }

  if (turn.text !== undefined) {
    return (
      <div className="flex flex-col items-end gap-1">
        {turn.source === "voice" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-dim">
            <Mic size={11} aria-hidden="true" />
            Vos · voz
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-dim">Vos</span>
        )}
        <p className="w-full rounded-md rounded-tr-sm border border-ok-bd bg-ok-bg px-3 py-2 text-sm text-foreground">
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
  if (turn.event !== undefined) {
    return (
      <Alert tone={turn.tone ?? "neutral"} role="status">
        {turn.event}
      </Alert>
    );
  }

  return null;
}

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
  useLiveTranscript((text) => {
    setTranscript((turns) => [
      ...turns,
      { id: `voice-${crypto.randomUUID()}`, kind: "chat", role: "operator", source: "voice", text, ts: Date.now() }
    ]);
  });

  // Timeline scroll-follow + jump-to-recent (Item 3). scrollRef is the existing
  // overflow-auto tabpanel; prevTurnCountRef lets the append effect tell a real
  // append apart from a re-filter/re-render.
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevTurnCountRef = useRef(0);
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
    const ts = Date.now();
    setTranscript((turns) => {
      // Belt-and-braces guard against any other path producing a collision.
      if (turns.some((turn) => turn.id === id)) return turns;
      return [...turns, { id, kind: "chat", role: "kira", text: data.text as string, fromAgenda, ts }];
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
      if (existingIndex === -1) return [...turns, { id: turnId, kind: "chat", role: "operator", text, ts: Date.now() }];
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
  function handleTimelineScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    setShowJump(!nearBottom);
  }

  const kiraThinkingTurn: Turn | null = isThinking ? { id: "kira-thinking", kind: "chat", role: "kira" } : null;
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
  const orderedTurns = [...interleaved, ...(kiraThinkingTurn ? [kiraThinkingTurn] : [])];
  const visibleTurns = orderedTurns.filter((turn) => matchesTab(activeTab, turn.kind));

  // On a genuine append (turn count grew): follow the bottom if the operator is
  // already near it (behavior:'smooth', "ir lentamente bajando"); otherwise
  // don't yank — surface the floating jump-to-recent button. Pure scrollTop
  // math on the existing container (jsdom-testable; no IntersectionObserver).
  useEffect(() => {
    const el = scrollRef.current;
    const grew = visibleTurns.length > prevTurnCountRef.current;
    prevTurnCountRef.current = visibleTurns.length;
    if (!el || !grew) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX) {
      el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      setShowJump(true);
    }
  }, [visibleTurns.length]);

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

  return (
    <aside className="flex min-h-0 flex-col border-l border-border-soft bg-card">
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
          className={cn("flex min-h-0 flex-1 flex-col", !feedActive && "pointer-events-none")}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <span className="mono text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Conversación</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-ok">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
              </span>
              sesión en vivo
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
                className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border-soft bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-panel animate-rise-in transition-colors duration-fast ease-io focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
