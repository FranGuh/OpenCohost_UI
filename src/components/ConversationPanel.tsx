import { useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { ChevronDown, MessageSquareOff, Mic, MicOff } from "lucide-react";
import { Alert } from "./ui/Alert.js";
import { ComposerCommandPanel } from "./ComposerCommandPanel.js";
import { Input } from "./ui/Input.js";
import { KiraFace } from "./ui/KiraFace.js";
import { Markdown } from "./ui/Markdown.js";
import { useAgendaEvents } from "../api/agenda.js";
import { useLastReply, useSendChatTurn } from "../api/chat.js";
import { usePttHold, type PttUiState } from "../api/ptt.js";
import { ERROR_COPY } from "../api/pttCopy.js";
import { cn } from "../lib/cn.js";
import { selectEvents, useEventStore, type AppEventTone } from "../store/eventStore.js";

const TABS = ["Todo", "Chat", "Alertas"] as const;
type Tab = (typeof TABS)[number];

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
  /** Agenda lifecycle / app-event copy (kind:"alert"). Rendered as a full-width
   * Alert (following the operator's chosen alert style), not a chat bubble. */
  event?: string;
  /** Tone the app-event carries (agenda events have none → neutral). Drives the
   * event line's Alert tone. */
  tone?: AppEventTone;
}

function matchesTab(tab: Tab, kind: TurnKind): boolean {
  if (tab === "Todo") return true;
  if (tab === "Chat") return kind === "chat";
  return kind === "alert";
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
        <span className="text-[11px] font-semibold text-dim">Vos</span>
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
  const [activeTab, setActiveTab] = useState<Tab>("Todo");
  const [message, setMessage] = useState("");
  // Composer command palette (mockup): a live, prefix-based detection — the
  // panel shows whenever the trimmed composer value starts with "/" or "!".
  const composerRef = useRef<HTMLDivElement>(null);
  const showCommandPanel = /^[/!]/.test(message.trim());
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
  const showEmptyState = activeTab !== "Alertas" && !hasChatKindTurns;

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

  return (
    <aside className="flex min-h-0 flex-col border-l border-border-soft bg-card">
      <div role="tablist" aria-label="Filtro de conversación" className="flex gap-1 border-b border-border-soft px-3 py-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            id={`conversation-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls="conversation-panel"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "mono h-7 rounded-full px-3 text-[12.5px] font-semibold text-muted-foreground transition-colors duration-fast ease-io",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              activeTab === tab && "bg-[color:var(--accent-soft)] text-primary"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

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
          aria-labelledby={`conversation-tab-${activeTab}`}
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
          {activeTab === "Alertas" && visibleTurns.length === 0 && (
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

      <div ref={composerRef} className="relative border-t border-border-soft bg-surface-2 p-3">
        {showCommandPanel && (
          <ComposerCommandPanel
            query={message}
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
        {pttError && <p role="status" className="mono mt-1 text-[11px] text-danger">{ERROR_COPY[pttError]}</p>}

        <form onSubmit={handleSubmit} className="mt-2">
          <Input
            type="text"
            value={message}
            onChange={handleMessageChange}
            placeholder="Escribí un mensaje para Kira…"
            aria-label="Mensaje para Kira"
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
                    pttState === "connecting" && "text-info animate-pulse",
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

      {isError && (
        <div className="px-3 pb-3">
          <Alert tone="danger">{error?.message ?? "No se pudo enviar el mensaje."}</Alert>
        </div>
      )}
    </aside>
  );
}
