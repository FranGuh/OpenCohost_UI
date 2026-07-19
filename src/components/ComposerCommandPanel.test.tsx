import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React, { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStore } from "../store/eventStore.js";
import { CommandPalettePopover, ComposerCommandPanel } from "./ComposerCommandPanel.js";

beforeEach(() => {
  useEventStore.setState({ events: [] });
});

/**
 * Owner layout correction (2026-07-18): the always-hosted command dialog above
 * the composer is gone. The composer now surfaces an emergent LAUNCHER popover
 * (CommandPalettePopover) while the input starts with "/" or "!" — a filtered,
 * keyboard-navigable list that SELECTS a command (routing it to the Comandos
 * tab) rather than hosting the stepper inline. The browsable stepper home is the
 * inline ComposerCommandPanel rendered in the Comandos tab; its per-command
 * stepper behaviour is covered in commands/commands.test.tsx.
 */

/**
 * Minimal composer shape for CommandPalettePopover's target-scoped keydown
 * (F2): a container ref wrapping the popover, the real text input the
 * handler must scope to, and an optional decoy control to prove that focus
 * elsewhere in the composer does NOT navigate/select. Also surfaces the
 * reported `aria-activedescendant` id on the input (F3).
 */
function Harness({
  query,
  onSelect,
  onClose,
  extraControl = false
}: {
  query: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  extraControl?: boolean;
}) {
  const composerRef = useRef<HTMLDivElement>(null);
  const [activeDescendant, setActiveDescendant] = useState<string | null>(null);
  return (
    <div ref={composerRef}>
      <CommandPalettePopover
        query={query}
        onSelect={onSelect}
        onClose={onClose}
        composerRef={composerRef}
        onActiveDescendantChange={setActiveDescendant}
      />
      <input aria-label="Mensaje para Kira" aria-activedescendant={activeDescendant ?? undefined} readOnly value={query} />
      {extraControl && (
        <button type="button" aria-label="otro control">
          otro control
        </button>
      )}
    </div>
  );
}

describe("CommandPalettePopover (emergent launcher)", () => {
  function renderLauncher(query: string, options?: { extraControl?: boolean }) {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<Harness query={query} onSelect={onSelect} onClose={onClose} extraControl={options?.extraControl} />);
    return { onSelect, onClose };
  }

  const composerInput = () => screen.getByLabelText("Mensaje para Kira");

  it("renders a labelled listbox of the commands matching the query", () => {
    renderLauncher("/ag");
    const listbox = screen.getByRole("listbox", { name: "Comandos disponibles" });
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("/agenda");
  });

  it("lists every command on a bare '/' and highlights the first by default", () => {
    renderLauncher("/");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(7);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("each launcher option carries a stable cmd-opt-<command> id (F3)", () => {
    renderLauncher("/ag");
    expect(screen.getByRole("option", { name: /\/agenda/ })).toHaveAttribute("id", "cmd-opt-agenda");
  });

  it("moves the highlight with ArrowDown/ArrowUp and clamps at both ends", () => {
    renderLauncher("/");
    const input = composerInput();
    const options = () => screen.getAllByRole("option");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");

    // Clamp at the top: many ups never wrap past the first option.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("reports the highlighted option's DOM id via onActiveDescendantChange, following the highlight (F3)", () => {
    renderLauncher("/");
    const input = composerInput();
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-opt-agenda");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "cmd-opt-perfil");
  });

  it("selects the highlighted command on Enter", () => {
    const { onSelect } = renderLauncher("/");
    const input = composerInput();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // → /perfil (second)
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("perfil");
  });

  it("selects a command on click", () => {
    const { onSelect } = renderLauncher("/te");
    fireEvent.click(screen.getByRole("option", { name: /\/temas/ }));
    expect(onSelect).toHaveBeenCalledWith("temas");
  });

  it("closes on Escape from the composer input", () => {
    const { onClose } = renderLauncher("/");
    fireEvent.keyDown(composerInput(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an unknown-command hint and Enter selects nothing", () => {
    const { onSelect } = renderLauncher("/xyz");
    expect(screen.getByText("comando desconocido")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.keyDown(composerInput(), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter/arrows from a focused control OTHER than the composer input do NOT navigate or select (F2)", () => {
    const { onSelect, onClose } = renderLauncher("/", { extraControl: true });
    const other = screen.getByRole("button", { name: "otro control" });

    fireEvent.keyDown(other, { key: "ArrowDown" });
    fireEvent.keyDown(other, { key: "Enter" });
    fireEvent.keyDown(other, { key: "Escape" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Highlight never moved off the first option either.
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });
});

describe("ComposerCommandPanel — inline browsable home (Comandos tab)", () => {
  const noop = () => {};
  function renderInline(activeId: string | null = null, onActiveIdChange = noop) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(ComposerCommandPanel, {
          inline: true,
          query: "",
          activeId,
          onActiveIdChange,
          onClose: noop
        })
      )
    );
  }

  it("lists all 7 commands with no floating dialog when no command is active", () => {
    renderInline(null);
    for (const badge of ["/agenda", "/perfil", "/temas", "/vivo", "/acciones", "/sesion", "/musica"]) {
      expect(screen.getByText(badge)).toBeInTheDocument();
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a controlled command directly (as launched from the popover)", () => {
    renderInline("agenda");
    // /agenda is a stepper — its first question renders when it is the active command.
    expect(screen.getByText("¿Qué tema querés agendar?")).toBeInTheDocument();
  });
});
