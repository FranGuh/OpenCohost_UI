import { useEffect, useState } from "react";
import { CircleSlash, Terminal } from "lucide-react";
import { cn } from "../lib/cn.js";
import { COMMANDS, matchCommands, type Command } from "./commands/registry.js";
import { Stepper } from "./commands/Stepper.js";

/**
 * Chat command surfaces — MOCKUP-era wiring, two presentations of ONE registry:
 *
 *  - `ComposerCommandPanel` (this file's default export path): the browsable
 *    home. Rendered inline in the Comandos tab; lists every command and hosts
 *    its Stepper/screen when picked. Escape/Cancelar returns to the list (R9).
 *  - `CommandPalettePopover`: the emergent launcher above the composer (owner
 *    layout correction 2026-07-18). Appears only while the composer input starts
 *    with "/" or "!", filters as the operator types, is keyboard-navigable
 *    (ArrowUp/Down + Enter), and SELECTS a command — routing it to the Comandos
 *    tab — rather than hosting the stepper itself.
 *
 * Both read the same `COMMANDS`/`matchCommands` registry — no second command
 * list data. `CommandList` renders both the browsable button list and the
 * launcher's listbox via its `variant` prop.
 */
interface ComposerCommandPanelProps {
  /** Live composer value — drives the command-list filter. */
  query: string;
  /** Escape / Cancelar in floating mode — parent clears the composer. */
  onClose: () => void;
  /** Inline mode (Comandos column tab, D8/R9): a plain region with no floating
   * `role="dialog"` chrome; cancel/close returns to the command list. */
  inline?: boolean;
  /** Controlled active command (optional). When provided, the parent owns which
   * command is open — the composer launcher uses this to open a command directly
   * in the Comandos tab. Uncontrolled (local state) when omitted. */
  activeId?: string | null;
  onActiveIdChange?: (id: string | null) => void;
  /** Whether this panel is the currently-visible one. Gates the document Escape
   * listener so an inline panel that stays mounted-but-hidden in an inactive tab
   * does not swallow the launcher's Escape. Defaults true. */
  visible?: boolean;
}

/** Shared command list. `browse` = the button list + Cancelar footer (Comandos
 * tab / floating palette). `launcher` = a keyboard-highlighted listbox of
 * `option`s for the emergent composer popover. One registry, two skins. */
export function CommandList({
  matches,
  onPick,
  onClose,
  variant = "browse",
  activeIndex
}: {
  matches: Command[];
  onPick: (id: string) => void;
  onClose?: () => void;
  variant?: "browse" | "launcher";
  activeIndex?: number;
}) {
  const launcher = variant === "launcher";

  if (matches.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 px-1 py-2 text-xs text-dim">
          <CircleSlash size={12} aria-hidden="true" />
          comando desconocido
        </p>
        {!launcher && <CancelRow onClose={onClose} />}
      </div>
    );
  }

  const rows = matches.map((command, index) => (
    <button
      key={command.id}
      type="button"
      role={launcher ? "option" : undefined}
      aria-selected={launcher ? index === activeIndex : undefined}
      tabIndex={launcher ? -1 : undefined}
      onClick={() => onPick(command.id)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border border-border-soft bg-surface-2 px-3 py-2 text-left transition-colors duration-fast ease-io",
        "hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        launcher && index === activeIndex && "border-[color:var(--accent)] bg-card ring-1 ring-[color:var(--accent)]"
      )}
    >
      <span className="mono rounded border border-border-soft bg-card px-1.5 py-0.5 text-[11px] font-semibold text-[var(--kira-cyan)]">
        {command.badge}
      </span>
      <span className="text-sm text-foreground">
        {command.id} — <span className="text-muted-foreground">{command.description}</span>
      </span>
    </button>
  ));

  if (launcher) {
    return (
      <div role="listbox" aria-label="Comandos disponibles" className="flex flex-col gap-1.5">
        {rows}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {matches.map((command, index) => (
          <li key={command.id}>{rows[index]}</li>
        ))}
      </ul>
      <CancelRow onClose={onClose} />
    </div>
  );
}

function CancelRow({ onClose }: { onClose?: () => void }) {
  return (
    <div className="mt-1 flex justify-end border-t border-border-soft pt-3">
      <button
        type="button"
        onClick={onClose}
        className="rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Cancelar
      </button>
    </div>
  );
}

/**
 * Emergent command launcher above the composer. Focus stays in the composer
 * input; this listens at the document level so ArrowUp/Down move the highlight
 * and Enter selects the highlighted command. Escape closes. Selecting routes the
 * command to the Comandos tab (the parent handles that) and closes the popover.
 */
export function CommandPalettePopover({
  query,
  onSelect,
  onClose
}: {
  query: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const matches = matchCommands(query);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset the highlight to the top whenever the filtered set changes.
  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        const command = matches[activeIndex];
        if (command) {
          event.preventDefault();
          onSelect(command.id);
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [matches, activeIndex, onClose, onSelect]);

  return (
    <div className="absolute inset-x-0 bottom-full z-50 mb-2 animate-rise-in rounded-md border border-border-soft bg-card p-3 shadow-panel">
      <div className="mono mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
        <Terminal size={12} aria-hidden="true" />
        Comandos
      </div>
      <CommandList variant="launcher" matches={matches} activeIndex={activeIndex} onPick={onSelect} />
    </div>
  );
}

export function ComposerCommandPanel({
  query,
  onClose,
  inline = false,
  activeId: controlledActiveId,
  onActiveIdChange,
  visible = true
}: ComposerCommandPanelProps) {
  const isControlled = controlledActiveId !== undefined;
  const [internalActiveId, setInternalActiveId] = useState<string | null>(null);
  const activeId = isControlled ? controlledActiveId : internalActiveId;
  const setActiveId = (id: string | null) => {
    if (!isControlled) setInternalActiveId(id);
    onActiveIdChange?.(id);
  };
  const active = activeId ? COMMANDS.find((command) => command.id === activeId) ?? null : null;
  const matches = matchCommands(query);
  // Screens own hooks, so they must render as a real component (not a call).
  const ActiveScreen = active?.screen;

  const returnToList = () => setActiveId(null);
  // Inline (Comandos tab) has no floating palette to dismiss, so cancel/close
  // returns to the command list (R9). Floating keeps the parent's onClose.
  const dismiss = inline ? returnToList : onClose;

  // Escape returns to the command list first, then closes the whole panel.
  // `visible` guards inactive-but-mounted inline panels from swallowing Escape.
  useEffect(() => {
    if (!visible) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (active) setActiveId(null);
      else if (!inline) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onClose, inline, visible]);

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
