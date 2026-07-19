import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
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

describe("CommandPalettePopover (emergent launcher)", () => {
  function renderLauncher(query: string) {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalettePopover query={query} onSelect={onSelect} onClose={onClose} />);
    return { onSelect, onClose };
  }

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

  it("moves the highlight with ArrowDown/ArrowUp and clamps at both ends", () => {
    renderLauncher("/");
    const options = () => screen.getAllByRole("option");

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");

    // Clamp at the top: many ups never wrap past the first option.
    fireEvent.keyDown(document, { key: "ArrowUp" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("selects the highlighted command on Enter", () => {
    const { onSelect } = renderLauncher("/");
    fireEvent.keyDown(document, { key: "ArrowDown" }); // → /perfil (second)
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("perfil");
  });

  it("selects a command on click", () => {
    const { onSelect } = renderLauncher("/te");
    fireEvent.click(screen.getByRole("option", { name: /\/temas/ }));
    expect(onSelect).toHaveBeenCalledWith("temas");
  });

  it("closes on Escape", () => {
    const { onClose } = renderLauncher("/");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an unknown-command hint and Enter selects nothing", () => {
    const { onSelect } = renderLauncher("/xyz");
    expect(screen.getByText("comando desconocido")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
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
