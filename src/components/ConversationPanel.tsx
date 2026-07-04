import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Badge } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { useLastReply, useSendChatTurn } from "../api/chat.js";
import { cn } from "../lib/cn.js";

const TABS = ["Todo", "Chat", "Alertas"] as const;
type Tab = (typeof TABS)[number];

type TurnKind = "chat" | "alert";

interface Turn {
  id: string;
  kind: TurnKind;
  /** Present only for operator-submitted turns (see handleSubmit) — canned
   * turns below render fixed copy keyed off `id` instead. */
  text?: string;
}

// Canned turn list. Tagged with `kind` so the Todo/Chat/Alertas tabs actually
// filter what's rendered. Kira's own reply turn is no longer canned here — it
// comes from useLastReply (see buildKiraTurn below).
const TURNS: readonly Turn[] = [
  { id: "viewer-question", kind: "chat" },
  { id: "mute-notice", kind: "alert" }
];

/** Builds the dynamic Kira turn: "thinking" while awaiting a reply to a
 * just-sent turn, the fetched reply once it lands, or nothing if neither
 * applies (fresh session, no reply yet). R8: only ever renders
 * server-provided Kira text. */
function buildKiraTurn(replyText: string | null | undefined, isThinking: boolean): Turn | null {
  if (isThinking) return { id: "kira-thinking", kind: "chat" };
  if (replyText) return { id: "kira-reply", kind: "chat", text: replyText };
  return null;
}

function matchesTab(tab: Tab, kind: TurnKind): boolean {
  if (tab === "Todo") return true;
  if (tab === "Chat") return kind === "chat";
  return kind === "alert";
}

function KiraBadgeLabel() {
  return (
    <span className="mono inline-flex w-fit items-center gap-[6px] text-[11px] font-semibold tracking-[0.06em] text-[var(--kira-cyan)]">
      <Badge tone="info" className="px-2 py-1">
        ◈
      </Badge>
      KIRA
    </span>
  );
}

function ConversationTurn({ turn }: { turn: Turn }) {
  if (turn.id === "kira-reply") {
    return (
      <div className="flex flex-col gap-1">
        <KiraBadgeLabel />
        <p className="max-w-[85%] rounded-md border border-border-soft bg-background px-3 py-2 text-sm text-foreground">
          {turn.text}
        </p>
      </div>
    );
  }

  if (turn.id === "kira-thinking") {
    return (
      <div className="flex flex-col gap-1">
        <KiraBadgeLabel />
        <p className="max-w-[85%] rounded-md border border-border-soft bg-background px-3 py-2 text-sm text-dim">
          Kira está pensando…
        </p>
      </div>
    );
  }

  if (turn.text !== undefined) {
    return (
      <div className="flex flex-col gap-1 self-end text-right">
        <span className="text-[11px] font-semibold text-dim">Vos</span>
        <p className="max-w-[85%] self-end rounded-md border border-border-soft bg-background px-3 py-2 text-sm text-foreground">
          {turn.text}
        </p>
      </div>
    );
  }

  if (turn.id === "viewer-question") {
    return (
      <div className="flex flex-col gap-1 self-end text-right">
        <span className="text-[11px] font-semibold text-dim">Vos</span>
        <p className="max-w-[85%] self-end rounded-md border border-border-soft bg-background px-3 py-2 text-sm text-foreground">
          ¿Cómo viene el stream hoy?
        </p>
      </div>
    );
  }

  return <p className="text-xs text-dim">🎫 el chat de viewers está silenciado</p>;
}

/** <aside> queue region — canned Kira-side turn list (no chat-history
 * endpoint exists — Kira's reply is audio-only per R8) + a composer wired to
 * the real POST /api/chat/turn (useSendChatTurn). The operator's own message
 * is appended locally as an ephemeral turn so it's visible immediately;
 * there's no server echo to reconcile against. */
export function ConversationPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("Todo");
  const [message, setMessage] = useState("");
  const [operatorTurns, setOperatorTurns] = useState<Turn[]>([]);
  const { send, pending, isError, error } = useSendChatTurn();
  const lastReply = useLastReply();
  // Tracks the operator bubble for the in-flight/retryable send intent, so a
  // retry after a failed send updates that SAME bubble instead of appending
  // a duplicate "Vos" turn. Cleared once the send succeeds.
  const pendingTurnIdRef = useRef<string | null>(null);
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
    setOperatorTurns((turns) => {
      const existingIndex = turns.findIndex((turn) => turn.id === turnId);
      if (existingIndex === -1) return [...turns, { id: turnId, kind: "chat", text }];
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

  const kiraTurn = buildKiraTurn(lastReply.data?.text, isThinking);
  const [viewerTurn, muteTurn] = TURNS;
  const baseTurns = kiraTurn ? [viewerTurn, kiraTurn, muteTurn] : [viewerTurn, muteTurn];
  const visibleTurns = [...baseTurns, ...operatorTurns].filter((turn) => matchesTab(activeTab, turn.kind));

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
        <span className="text-xs text-dim">sesión en vivo</span>
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

      <form onSubmit={handleSubmit} className="grid grid-cols-[1fr_auto] gap-2 border-t border-border-soft p-3">
        <input
          type="text"
          value={message}
          onChange={handleMessageChange}
          placeholder="Escribí un mensaje para Kira…"
          aria-label="Mensaje para Kira"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <Button type="submit" variant="primary" disabled={pending}>
          Enviar
        </Button>
      </form>

      {isError && (
        <p role="alert" className="px-3 pb-3 text-xs text-danger">
          {error?.message ?? "No se pudo enviar el mensaje."}
        </p>
      )}
    </aside>
  );
}
