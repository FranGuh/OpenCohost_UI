import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Badge } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { DEFAULT_TRANSCRIPT } from "./kiraState.js";
import { useSendChatTurn } from "../api/chat.js";
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

// Canned turn list (no chat-history endpoint exists in P1 — Kira's reply is
// audio-only per R8, there's nothing to fetch). Tagged with `kind` so the
// Todo/Chat/Alertas tabs actually filter what's rendered.
const TURNS: readonly Turn[] = [
  { id: "viewer-question", kind: "chat" },
  { id: "kira-reply", kind: "chat" },
  { id: "mute-notice", kind: "alert" }
];

function matchesTab(tab: Tab, kind: TurnKind): boolean {
  if (tab === "Todo") return true;
  if (tab === "Chat") return kind === "chat";
  return kind === "alert";
}

function ConversationTurn({ turn }: { turn: Turn }) {
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

  if (turn.id === "kira-reply") {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center gap-[6px] text-[11px] font-semibold text-[var(--kira-cyan)]">
          <Badge tone="info" className="bg-[image:var(--spectrum-soft)] border-transparent px-2 py-1">
            ◈
          </Badge>
          KIRA
        </span>
        <p className="max-w-[85%] rounded-md border border-border-soft bg-background px-3 py-2 text-sm text-foreground">
          {DEFAULT_TRANSCRIPT}
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

  function handleMessageChange(event: ChangeEvent<HTMLInputElement>) {
    setMessage(event.target.value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;

    setOperatorTurns((turns) => [...turns, { id: `operator-${turns.length}-${Date.now()}`, kind: "chat", text }]);

    try {
      await send(text);
      setMessage("");
    } catch {
      // isError/error below already carry this reactively — the message
      // stays in the input so the operator can retry without retyping it.
    }
  }

  const visibleTurns = [...TURNS, ...operatorTurns].filter((turn) => matchesTab(activeTab, turn.kind));

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
              "h-7 rounded-full px-3 text-[12.5px] font-semibold text-muted-foreground transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              activeTab === tab && "bg-[image:var(--spectrum-soft)] text-[var(--kira-cyan)]"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Conversación</span>
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
        <Button type="submit" variant="primary" className="bg-[image:var(--spectrum)]" disabled={pending}>
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
