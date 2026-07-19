import { useEffect, useState } from "react";
import { CircleSlash, Terminal } from "lucide-react";
import { cn } from "../lib/cn.js";
import { COMMANDS, matchCommands, type Command } from "./commands/registry.js";
import { Stepper } from "./commands/Stepper.js";

/**
 * Chat command palette — MOCKUP ONLY. When the composer value starts with "/"
 * or "!", ConversationPanel mounts this floating panel above the composer.
 *
 * State 1 (list): every command in the registry, filtered live by the prefix
 * text ("/ac" → /acciones). State 2 (active): the picked command runs either a
 * one-question-at-a-time Stepper (ending on an inert SummaryCard) or a custom
 * review/action screen. Escape returns to the command list first, then closes.
 *
 * This round makes NO network call and mutates NO store — every final action is
 * disabled or shows a "maquetado" acknowledgement. See commands/ for the
 * reusable primitives and the per-command definitions.
 */
interface ComposerCommandPanelProps {
  /** Live composer value — drives the command-list filter. The parent only
   * mounts this while the trimmed value starts with "/" or "!". */
  query: string;
  /** Escape / Cancelar — parent clears the composer and restores its focus. */
  onClose: () => void;
  /** Inline mode (Comandos column tab, D8/R9): renders as a plain region with
   * no `role="dialog"` floating chrome, and cancel/close returns to the command
   * list instead of dismissing (there is no floating palette to dismiss). */
  inline?: boolean;
}

function CommandList({
  matches,
  onPick,
  onClose
}: {
  matches: Command[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {matches.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {matches.map((command) => (
            <li key={command.id}>
              <button
                type="button"
                onClick={() => onPick(command.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md border border-border-soft bg-surface-2 px-3 py-2 text-left transition-colors duration-fast ease-io",
                  "hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                )}
              >
                <span className="mono rounded border border-border-soft bg-card px-1.5 py-0.5 text-[11px] font-semibold text-[var(--kira-cyan)]">
                  {command.badge}
                </span>
                <span className="text-sm text-foreground">
                  {command.id} — <span className="text-muted-foreground">{command.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 px-1 py-2 text-xs text-dim">
          <CircleSlash size={12} aria-hidden="true" />
          comando desconocido
        </p>
      )}
      <div className="mt-1 flex justify-end border-t border-border-soft pt-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function ComposerCommandPanel({ query, onClose, inline = false }: ComposerCommandPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId ? COMMANDS.find((command) => command.id === activeId) ?? null : null;
  const matches = matchCommands(query);
  // Screens own hooks, so they must render as a real component (not a call).
  const ActiveScreen = active?.screen;

  const returnToList = () => setActiveId(null);
  // Inline (Comandos tab) has no floating palette to dismiss, so cancel/close
  // returns to the command list (R9). Floating keeps the parent's onClose.
  const dismiss = inline ? returnToList : onClose;

  // Escape returns to the command list first, then closes the whole panel
  // (mirrors StatusChip's document-level listener rather than a handler on a
  // non-interactive node). Inline mode has nothing to close at the list level.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (active) setActiveId(null);
      else if (!inline) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onClose, inline]);

  const content = (
    <>
      <div className="mono mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
        <Terminal size={12} aria-hidden="true" />
        Comandos del chat
      </div>

      {/* Steps/selections are announced politely without interrupting the composer. */}
      <div aria-live="polite" className="flex flex-col gap-2">
        {active ? (
          ActiveScreen ? (
            <ActiveScreen onClose={dismiss} />
          ) : (
            <Stepper key={active.id} command={active} onDiscard={returnToList} onCancel={dismiss} />
          )
        ) : (
          <CommandList matches={matches} onPick={setActiveId} onClose={dismiss} />
        )}
      </div>
    </>
  );

  // Inline: a plain region inside the Comandos tabpanel (no floating dialog).
  if (inline) {
    return <div className="flex flex-col">{content}</div>;
  }

  return (
    <div
      role="dialog"
      aria-label="Comandos del chat"
      className="absolute inset-x-0 bottom-full z-50 mb-2 animate-rise-in rounded-md border border-border-soft bg-card p-3 shadow-panel"
    >
      {content}
    </div>
  );
}
