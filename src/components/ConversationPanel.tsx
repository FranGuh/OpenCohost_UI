import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Badge } from "./ui/Badge.js";
import { Input } from "./ui/Input.js";
import { useAgendaEvents } from "../api/agenda.js";
import { useLastReply, useSendChatTurn } from "../api/chat.js";
import { cn } from "../lib/cn.js";

const TABS = ["Todo", "Chat", "Alertas"] as const;
type Tab = (typeof TABS)[number];

type TurnKind = "chat" | "alert";

interface Turn {
  id: string;
  kind: TurnKind;
  /** Marks a turn as Kira-authored (the transient "thinking" indicator or a
   * real accumulated reply) so ConversationTurn can distinguish it from an
   * operator bubble without relying on a magic id string. */
  role?: "operator" | "kira";
  /** Present for operator-submitted turns and accumulated Kira replies —
   * canned turns below (viewer-question/mute-notice) render fixed copy keyed
   * off `id` instead. */
  text?: string;
  /** Client arrival time (Date.now() at observe/append time). Undefined for
   * the canned bookend turns (viewer-question / mute-notice), which stay
   * pinned first/last regardless of the interleave. */
  ts?: number;
  /** True when this Kira reply came from an autonomous agenda turn
   * (last-reply `source` startsWith "kira-agenda") rather than a reply to
   * operator/viewer chat — drives a distinct KIRA · AGENDA label. */
  fromAgenda?: boolean;
  /** Agenda lifecycle event copy (kind:"alert"). Rendered as a centered
   * divider line like the mute-notice, not a chat bubble. */
  event?: string;
}

// Canned turn list. Tagged with `kind` so the Todo/Chat/Alertas tabs actually
// filter what's rendered. Kira's own reply turns are never canned here — they
// come from useLastReply, accumulated session-locally (see the transcript
// state in ConversationPanel below).
const TURNS: readonly Turn[] = [
  { id: "viewer-question", kind: "chat" },
  { id: "mute-notice", kind: "alert" }
];

function matchesTab(tab: Tab, kind: TurnKind): boolean {
  if (tab === "Todo") return true;
  if (tab === "Chat") return kind === "chat";
  return kind === "alert";
}

function KiraBadgeLabel({ fromAgenda = false }: { fromAgenda?: boolean }) {
  return (
    <span className="mono inline-flex w-fit items-center gap-[6px] text-[11px] font-semibold tracking-[0.06em] text-[var(--kira-cyan)]">
      <Badge tone="info" className="px-2 py-1">
        ◈
      </Badge>
      {fromAgenda ? "KIRA · AGENDA" : "KIRA"}
    </span>
  );
}

function ConversationTurn({ turn }: { turn: Turn }) {
  if (turn.role === "kira" && turn.text === undefined) {
    return (
      <div className="flex flex-col gap-1.5">
        <KiraBadgeLabel />
        <p className="max-w-[82%] animate-pulse rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm italic text-dim">
          Kira está pensando…
        </p>
      </div>
    );
  }

  if (turn.role === "kira") {
    return (
      <div className="flex flex-col gap-1.5">
        <KiraBadgeLabel fromAgenda={turn.fromAgenda} />
        <p className="max-w-[82%] rounded-md rounded-tl-sm border border-border bg-surface-2 px-3 py-2 text-sm text-foreground">
          {turn.text}
        </p>
      </div>
    );
  }

  if (turn.text !== undefined) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11px] font-semibold text-dim">Vos</span>
        <p className="max-w-[82%] rounded-md rounded-tr-sm border border-ok-bd bg-ok-bg px-3 py-2 text-sm text-foreground">
          {turn.text}
        </p>
      </div>
    );
  }

  if (turn.id === "viewer-question") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11px] font-semibold text-dim">Vos</span>
        <p className="max-w-[82%] rounded-md rounded-tr-sm border border-ok-bd bg-ok-bg px-3 py-2 text-sm text-foreground">
          ¿Cómo viene el stream hoy?
        </p>
      </div>
    );
  }

  // Agenda lifecycle event — same centered-divider treatment as the mute-notice.
  if (turn.event !== undefined) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
        <span className="text-xs text-dim">{turn.event}</span>
        <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
      </div>
    );
  }

  // mute-notice — rendered as a metadata divider, not a chat bubble
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
      <span className="text-xs text-dim">🎫 el chat de viewers está silenciado</span>
      <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
    </div>
  );
}

/** <aside> queue region — canned Kira-side turn list (no chat-history
 * endpoint exists — Kira's reply is audio-only per R8) + a composer wired to
 * the real POST /api/chat/turn (useSendChatTurn). The operator's own message
 * is appended locally as an ephemeral turn so it's visible immediately;
 * there's no server echo to reconcile against. */
export function ConversationPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("Todo");
  const [message, setMessage] = useState("");
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
  // stream below as alert dividers, reusing the Alertas tab + mute-notice style.
  const agendaEvents = useAgendaEvents();
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

  const isThinking = pending || awaitingReply;

  function handleMessageChange(event: ChangeEvent<HTMLInputElement>) {
    setMessage(event.target.value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // block concurrent submits (e.g. rapid Enter presses)
    const text = message.trim();
    if (!text) return;

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

  const kiraThinkingTurn: Turn | null = isThinking ? { id: "kira-thinking", kind: "chat", role: "kira" } : null;
  const [viewerTurn, muteTurn] = TURNS;
  const agendaTurns: Turn[] = agendaEvents.map((event) => ({
    id: event.id,
    kind: "alert",
    event: event.label,
    ts: event.ts
  }));
  // Order: canned viewer question, then the real stream — operator sends, Kira
  // replies, and agenda events interleaved by client arrival time (Date.now()
  // at observe-time). The transcript already used append/arrival order as its
  // ordering contract; making `ts` explicit lets the two independent streams
  // (chat poll + agenda poll) merge deterministically. Then the ephemeral
  // "pensando" indicator and the canned mute-notice divider close it out.
  const interleaved = [...transcript, ...agendaTurns].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const orderedTurns = [
    viewerTurn,
    ...interleaved,
    ...(kiraThinkingTurn ? [kiraThinkingTurn] : []),
    muteTurn
  ];
  const visibleTurns = orderedTurns.filter((turn) => matchesTab(activeTab, turn.kind));

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
              "mono h-7 rounded-full px-3 text-[12.5px] font-semibold text-muted-foreground transition-colors",
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

      <div
        role="tabpanel"
        id="conversation-panel"
        tabIndex={0}
        aria-labelledby={`conversation-tab-${activeTab}`}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {visibleTurns.map((turn) => (
          <ConversationTurn key={turn.id} turn={turn} />
        ))}
        {visibleTurns.length === 0 && <p className="text-xs text-dim">Sin turnos en este filtro.</p>}
      </div>

      <div className="border-t border-border-soft bg-surface-2 p-3">
        <form onSubmit={handleSubmit}>
          <Input
            type="text"
            value={message}
            onChange={handleMessageChange}
            placeholder="Escribí un mensaje para Kira…"
            aria-label="Mensaje para Kira"
            trailing={
              <button
                type="submit"
                disabled={pending}
                className="flex items-center px-4 text-sm font-semibold bg-[image:var(--accent-grad)] text-[var(--accent-contrast)] transition-opacity disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Enviar
              </button>
            }
          />
        </form>
      </div>

      {isError && (
        <p role="alert" className="px-3 pb-3 text-xs text-danger">
          {error?.message ?? "No se pudo enviar el mensaje."}
        </p>
      )}
    </aside>
  );
}
