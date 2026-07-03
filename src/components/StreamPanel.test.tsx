import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreamPanel } from "./StreamPanel.js";
import { STREAM_FIXTURE } from "../api/mock/fixtures.js";

describe("StreamPanel", () => {
  it("renders the Chat en vivo URL input and Conectar button, starting desconectado", () => {
    render(<StreamPanel />);
    expect(screen.getByLabelText("URL del directo")).toHaveValue(STREAM_FIXTURE.url);
    expect(screen.getByRole("button", { name: "Conectar" })).toBeInTheDocument();
    expect(screen.getByText("desconectado")).toBeInTheDocument();
  });

  it("rejects an invalid URL shape locally without ever going to conectando/conectado", () => {
    render(<StreamPanel />);
    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "no es una url" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("desconectado")).toBeInTheDocument();
  });

  it("connects with a valid URL through the mock command, discloses the missing endpoint, and re-enables Desconectar", async () => {
    render(<StreamPanel />);
    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "https://twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));

    expect(screen.getByText("conectando…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());

    expect(screen.getByText(/no existe todavía el endpoint/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desconectar" })).not.toBeDisabled();
  });

  it("disconnects back to desconectado once connected", async () => {
    render(<StreamPanel />);
    fireEvent.change(screen.getByLabelText("URL del directo"), { target: { value: "https://twitch.tv/kira" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(screen.getByText("conectado")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));

    expect(screen.getByText("desconectado")).toBeInTheDocument();
  });

  it("Desconectar stays disabled while not connected", () => {
    render(<StreamPanel />);
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeDisabled();
  });

  it("defaults the reaction threshold and cooldown selects from the fixture", () => {
    render(<StreamPanel />);
    expect(screen.getByLabelText("Umbral de reacciones")).toHaveValue(STREAM_FIXTURE.reaction_threshold);
    expect(screen.getByLabelText("Cooldown entre reacciones")).toHaveValue(STREAM_FIXTURE.cooldown);
    expect(screen.getByLabelText("Límite de spam")).toHaveValue(STREAM_FIXTURE.spam_limit);
  });

  it("highlights only the preset matching the initial fixture value, and none when no preset matches", () => {
    render(<StreamPanel />);
    const reactionGroup = screen.getByRole("group", { name: "Preset de reacciones" });
    const cooldownGroup = screen.getByRole("group", { name: "Preset de cooldown" });

    // fixture reaction_threshold "1" msg/s maps to the "medio" preset.
    expect(within(reactionGroup).getByRole("button", { name: "Medio" })).toHaveAttribute("aria-pressed", "true");
    expect(within(reactionGroup).getByRole("button", { name: "Bajo" })).toHaveAttribute("aria-pressed", "false");
    expect(within(reactionGroup).getByRole("button", { name: "Alto" })).toHaveAttribute("aria-pressed", "false");

    // fixture cooldown "45" does not map to any preset (30/60/120) — nothing pressed.
    for (const button of within(cooldownGroup).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("picking a Select value with no matching preset clears the preset highlight", async () => {
    render(<StreamPanel />);
    const cooldownGroup = screen.getByRole("group", { name: "Preset de cooldown" });
    const cooldownSelect = screen.getByLabelText("Cooldown entre reacciones");

    fireEvent.change(cooldownSelect, { target: { value: "30" } });
    expect(within(cooldownGroup).getByRole("button", { name: "Bajo" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(within(cooldownGroup).getByRole("button", { name: "Bajo" })).not.toBeDisabled());

    fireEvent.change(cooldownSelect, { target: { value: "45" } });
    for (const button of within(cooldownGroup).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
    await waitFor(() => expect(cooldownSelect).not.toBeDisabled());
  });

  it("selecting a reaction preset marks it pressed, runs the mock command, and updates the sibling Select", async () => {
    render(<StreamPanel />);
    const altoButtons = screen.getAllByRole("button", { name: "Alto" });
    const reactionAlto = altoButtons[0];
    fireEvent.click(reactionAlto);

    expect(reactionAlto).toHaveAttribute("aria-pressed", "true");
    expect(reactionAlto).toBeDisabled();
    expect(screen.getByLabelText("Umbral de reacciones")).toHaveValue("3");
    await waitFor(() => expect(reactionAlto).not.toBeDisabled());
    expect(screen.getByLabelText("Umbral de reacciones")).toHaveValue("3");
  });

  it("selecting a cooldown preset marks it pressed independently from the reaction preset, and updates the sibling Select", async () => {
    render(<StreamPanel />);
    const bajoButtons = screen.getAllByRole("button", { name: "Bajo" });
    const cooldownBajo = bajoButtons[1];
    fireEvent.click(cooldownBajo);

    expect(cooldownBajo).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Cooldown entre reacciones")).toHaveValue("30");
    await waitFor(() => expect(cooldownBajo).not.toBeDisabled());
    expect(screen.getByLabelText("Cooldown entre reacciones")).toHaveValue("30");
  });

  it("changing the spam select runs the mock command", async () => {
    render(<StreamPanel />);
    const select = screen.getByLabelText("Límite de spam");
    fireEvent.change(select, { target: { value: "20" } });

    expect(select).toBeDisabled();
    await waitFor(() => expect(select).not.toBeDisabled());
    expect(select).toHaveValue("20");
  });

  it("Input Contract switch defaults off per the fixture and toggles through the mock command", async () => {
    render(<StreamPanel />);
    const toggle = screen.getByRole("switch", { name: "Input Contract" });
    expect(toggle).toHaveAttribute("aria-checked", String(STREAM_FIXTURE.input_contract));

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeDisabled();
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it("associates each threshold Select with its visible helper text via aria-describedby", () => {
    render(<StreamPanel />);

    const reactionSelect = screen.getByLabelText("Umbral de reacciones");
    const reactionHelperId = reactionSelect.getAttribute("aria-describedby");
    expect(reactionHelperId).toBeTruthy();
    expect(document.getElementById(reactionHelperId!)).toHaveTextContent("Reaccionar si el chat supera");

    const cooldownSelect = screen.getByLabelText("Cooldown entre reacciones");
    const cooldownHelperId = cooldownSelect.getAttribute("aria-describedby");
    expect(cooldownHelperId).toBeTruthy();
    expect(document.getElementById(cooldownHelperId!)).toHaveTextContent("Esperar al menos, entre reacciones");

    const spamSelect = screen.getByLabelText("Límite de spam");
    const spamHelperId = spamSelect.getAttribute("aria-describedby");
    expect(spamHelperId).toBeTruthy();
    expect(document.getElementById(spamHelperId!)).toHaveTextContent("Límite de mensajes repetidos");
  });

  it("discloses that reaction/cooldown/spam/input-contract limits have no backend endpoint yet", () => {
    render(<StreamPanel />);
    expect(screen.getByText(/PUT \/api\/stream\/chat-live\/limits/)).toBeInTheDocument();
  });

  it("shows a single non-interactive deferred note for the RF4 Emisión area (OAuth/metadata/moderación)", () => {
    render(<StreamPanel />);
    const heading = screen.getByRole("heading", { name: /Emisión/ });
    expect(heading).toBeInTheDocument();
    const card = heading.closest("div")?.parentElement as HTMLElement;
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryAllByRole("textbox")).toHaveLength(0);
  });
});
