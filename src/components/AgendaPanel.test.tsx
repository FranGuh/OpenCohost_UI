import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgendaPanel } from "./AgendaPanel.js";

describe("AgendaPanel", () => {
  it("renders the co-host profile name and session settings controls", () => {
    render(<AgendaPanel />);
    expect(screen.getByLabelText("Nombre del perfil co-host")).toHaveValue("Natural");
    expect(screen.getByLabelText("Turnos por tema")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Modo de seguridad en vivo")).toHaveValue("live_safe");
  });

  it("shows the currently-active topic from the fixture, highlighted as live", () => {
    render(<AgendaPanel />);
    const now = screen.getByTestId("agenda-now");
    expect(within(now).getByText("Mods como cultura popular en gaming")).toBeInTheDocument();
    expect(within(now).getByText("en vivo")).toBeInTheDocument();
  });

  it("lists queued topics in order with a priority badge each", () => {
    render(<AgendaPanel />);
    const items = screen.getAllByRole("listitem", { name: /^tema en cola/i });
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("La nostalgia noventera en internet")).toBeInTheDocument();
    expect(within(items[1]).getByText("Streamers y burnout")).toBeInTheDocument();
    expect(within(items[2]).getByText("Colecciones digitales")).toBeInTheDocument();
  });

  it("reorders a queued topic up through the mock command", async () => {
    render(<AgendaPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Subir "Streamers y burnout"/ }));

    await waitFor(() => {
      const items = screen.getAllByRole("listitem", { name: /^tema en cola/i });
      expect(within(items[0]).getByText("Streamers y burnout")).toBeInTheDocument();
    });
  });

  it("removes a queued topic through the mock command", async () => {
    render(<AgendaPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Quitar "Colecciones digitales"/ }));

    await waitFor(() =>
      expect(screen.queryByText("Colecciones digitales")).not.toBeInTheDocument()
    );
  });

  it("approving a suggestion moves it into the queue and discloses it is not persisted", async () => {
    render(<AgendaPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Aprobar "IA generativa en overlays de stream"/ }));

    await waitFor(() =>
      expect(screen.getAllByText("IA generativa en overlays de stream")).toHaveLength(1)
    );
    const items = screen.getAllByRole("listitem", { name: /^tema en cola/i });
    expect(items).toHaveLength(4);
    expect(screen.getByText(/no existe POST/)).toBeInTheDocument();
  });

  it("rejecting a suggestion removes it without adding it to the queue", async () => {
    render(<AgendaPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Rechazar "Por qué el chat repite memes viejos"/ }));

    await waitFor(() =>
      expect(screen.queryByText("Por qué el chat repite memes viejos")).not.toBeInTheDocument()
    );
    const items = screen.getAllByRole("listitem", { name: /^tema en cola/i });
    expect(items).toHaveLength(3);
  });

  it("rejects an empty title on the add-topic form", () => {
    render(<AgendaPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El título no puede estar vacío.");
  });

  it("adds a valid topic to the queue and discloses it is not persisted", async () => {
    render(<AgendaPanel />);
    fireEvent.change(screen.getByLabelText("Título del tema"), { target: { value: "Un tema nuevo" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a cola" }));

    await waitFor(() => expect(screen.getByText("Un tema nuevo")).toBeInTheDocument());
    expect(screen.getByLabelText("Título del tema")).toHaveValue("");
    expect(screen.getByText(/no existe todavía POST/)).toBeInTheDocument();
  });

  it("gates session control buttons: Activar disabled while already active", () => {
    render(<AgendaPanel />);
    expect(screen.getByRole("button", { name: "Activar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pausa suave" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Emergencia" })).not.toBeDisabled();
  });

  it("Emergencia stops the session, clears Ahora, and re-enables Activar", async () => {
    render(<AgendaPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Emergencia" }));

    await waitFor(() => expect(screen.getByText("Sin tema activo en este momento.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Activar" })).not.toBeDisabled());
    expect(screen.getByRole("button", { name: "Pausa suave" })).toBeDisabled();
  });

  it("Pausa suave flips the session status badge without clearing Ahora", async () => {
    render(<AgendaPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Pausa suave" }));

    await waitFor(() => expect(screen.getByText("pausa suave")).toBeInTheDocument());
    expect(screen.getByTestId("agenda-now")).toHaveTextContent("Mods como cultura popular en gaming");
  });

  it("resumes from paused back to active preserving Ahora, relabeling Activar to Reanudar", async () => {
    render(<AgendaPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Pausa suave" }));
    await waitFor(() => expect(screen.getByText("pausa suave")).toBeInTheDocument());

    const resumeButton = await screen.findByRole("button", { name: "Reanudar" });
    await waitFor(() => expect(resumeButton).not.toBeDisabled());
    expect(screen.queryByRole("button", { name: "Activar" })).not.toBeInTheDocument();

    fireEvent.click(resumeButton);

    await waitFor(() => expect(screen.getByText("activa")).toBeInTheDocument());
    expect(screen.getByTestId("agenda-now")).toHaveTextContent("Mods como cultura popular en gaming");
    expect(screen.getAllByRole("listitem", { name: /^tema en cola/i })).toHaveLength(3);
  });

  it("labels each suggestion list item and the list itself for accessibility, matching QueueCard's pattern", () => {
    render(<AgendaPanel />);
    expect(screen.getByRole("list", { name: "Sugerencias de Kira" })).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "IA generativa en overlays de stream" })
    ).toBeInTheDocument();
  });
});
