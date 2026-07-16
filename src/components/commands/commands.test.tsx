import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerCommandPanel } from "../ComposerCommandPanel.js";

/**
 * Framework-level tests for the command palette. These render
 * ComposerCommandPanel directly (no ConversationPanel harness) — the panel
 * makes no network call and mutates no store, so a fetch spy must stay at 0.
 */

const noop = () => {};

function renderPanel(query: string) {
  return render(<ComposerCommandPanel query={query} onClose={noop} />);
}

/** Click a command's list entry to enter it. */
function enterCommand(labelPattern: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: labelPattern }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("command palette — registry + primitives (mockup)", () => {
  it("lists all seven commands and filters live by prefix", () => {
    const { rerender } = renderPanel("/");
    for (const badge of ["/agenda", "/perfil", "/temas", "/vivo", "/acciones", "/sesion", "/musica"]) {
      expect(screen.getByText(badge)).toBeInTheDocument();
    }

    // "/ac" narrows to /acciones only.
    rerender(<ComposerCommandPanel query="/ac" onClose={noop} />);
    expect(screen.getByText("/acciones")).toBeInTheDocument();
    expect(screen.queryByText("/agenda")).not.toBeInTheDocument();

    // "/mu" narrows to /musica only.
    rerender(<ComposerCommandPanel query="/mu" onClose={noop} />);
    expect(screen.getByText("/musica")).toBeInTheDocument();
    expect(screen.queryByText("/agenda")).not.toBeInTheDocument();

    // An unknown command shows the empty note.
    rerender(<ComposerCommandPanel query="/zzz" onClose={noop} />);
    expect(screen.getByText("comando desconocido")).toBeInTheDocument();
  });

  it("/agenda caps the tema at 90 chars with a live counter", () => {
    renderPanel("/agenda");
    enterCommand(/agenda — programá un tema/);

    const tema = screen.getByLabelText("¿Qué tema querés agendar?") as HTMLInputElement;
    fireEvent.change(tema, { target: { value: "a".repeat(120) } });

    expect(tema.value).toHaveLength(90);
    expect(screen.getByText("90/90")).toBeInTheDocument();
  });

  it("/perfil renders the Identidad and Sesión sections", () => {
    renderPanel("/perfil");
    enterCommand(/perfil — creá o ajustá/);

    // Step 0 (nombre) is under Identidad.
    expect(screen.getByText("Identidad")).toBeInTheDocument();
    expect(screen.queryByText("Sesión")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("¿Cómo se llama el perfil?"), { target: { value: "Kira dry" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → estilo (Identidad)
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → turnos (Sesión)

    expect(screen.getByText("Sesión")).toBeInTheDocument();
    expect(screen.getByText("se aplica al instante")).toBeInTheDocument();
  });

  it("/temas is a read-only agenda review list, no stepper", () => {
    renderPanel("/temas");
    enterCommand(/temas — mirá qué hay en agenda/);

    expect(screen.getByRole("list", { name: "Temas en agenda" })).toBeInTheDocument();
    expect(screen.getByText("Nostalgia de los 2000 en gaming")).toBeInTheDocument();
    expect(screen.getByText("maquetado — va a leer la agenda real")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Siguiente" })).not.toBeInTheDocument();
  });

  it("/acciones surfaces the DISABLED input-contract switch with its verbatim note", () => {
    renderPanel("/acciones");
    enterCommand(/acciones — configurá cómo reacciona Kira/);

    // Advance past the three select groups to the Contrato de entrada step.
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → cooldown
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → spam
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // → contrato

    const contractSwitch = screen.getByRole("switch", { name: "Input Contract (contexto real)" });
    expect(contractSwitch).toBeDisabled();
    expect(
      screen.getByText("El endpoint ya acepta filter_policy — falta decidir qué preset corresponde a este switch.")
    ).toBeInTheDocument();
  });

  it("/sesion emergency button is inert (only a maquetado acknowledgement)", () => {
    renderPanel("/sesion");
    enterCommand(/sesion — controlá la sesión/);

    const emergency = screen.getByRole("button", { name: "Parada de emergencia" });
    expect(screen.queryByText("maquetado — sin efecto todavía")).not.toBeInTheDocument();

    fireEvent.click(emergency);
    expect(screen.getByText("maquetado — sin efecto todavía")).toBeInTheDocument();
  });

  it("/musica goes straight to the summary for a transport action (no song step)", () => {
    renderPanel("/musica");
    enterCommand(/musica — controlá la música/);

    // Default action is Reproducir → a single visible step, so "Revisar" leads
    // straight to the summary and the conditional song step never appears.
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(screen.queryByText("¿Qué canción?")).not.toBeInTheDocument();

    const primary = screen.getByRole("button", { name: "Aplicar" });
    expect(primary).toBeDisabled();
  });

  it("/musica reveals the song step only for 'Poner una canción' and keeps the action disabled", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderPanel("/musica");
    enterCommand(/musica — controlá la música/);

    // The song step is gated until the action is switched to "Poner una canción".
    expect(screen.queryByText("¿Qué canción?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "¿Qué querés hacer?" }));
    fireEvent.click(screen.getByRole("option", { name: "Poner una canción" }));
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    const song = screen.getByLabelText("¿Qué canción?") as HTMLInputElement;
    fireEvent.change(song, { target: { value: "Gorillaz — Feel Good Inc" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));

    const primary = screen.getByRole("button", { name: "Poner canción" });
    expect(primary).toBeDisabled();
    // The song collapses to a chip (top row + SummaryCard both render it).
    expect(screen.getAllByText("Gorillaz — Feel Good Inc").length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Descartar at the summary returns to the command list", () => {
    renderPanel("/vivo");
    enterCommand(/vivo — conectá el chat en vivo/);

    // Walk the two steps to the summary.
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); // plataforma → canal
    fireEvent.change(screen.getByLabelText("Canal o URL"), { target: { value: "twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" })); // → summary

    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    // Back to the list: the command entry is visible again, the summary is gone.
    expect(screen.getByRole("button", { name: /vivo — conectá el chat en vivo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
  });

  it("makes NO network call while driving commands and screens", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // A stepper command…
    const { unmount } = renderPanel("/agenda");
    enterCommand(/agenda — programá un tema/);
    fireEvent.change(screen.getByLabelText("¿Qué tema querés agendar?"), { target: { value: "mods retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    unmount();

    // …and an action screen. (Fresh mount — activeId is internal panel state.)
    renderPanel("/sesion");
    enterCommand(/sesion — controlá la sesión/);
    fireEvent.click(screen.getByRole("button", { name: "Activar" }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
