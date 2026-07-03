import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConversationPanel } from "./ConversationPanel.js";

describe("ConversationPanel", () => {
  it("shows the canned Kira turn seeded from the default transcript", () => {
    render(<ConversationPanel />);
    expect(screen.getByText(/Preparando el motor/)).toBeInTheDocument();
  });

  it("shows a P2 note when the composer is submitted instead of sending", () => {
    render(<ConversationPanel />);
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Enviar: se habilitará/);
  });

  it("switches the active filter tab and marks aria-selected", () => {
    render(<ConversationPanel />);
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    fireEvent.click(chatTab);
    expect(chatTab).toHaveAttribute("aria-selected", "true");
  });

  it("filters the visible turns by tab and wires honest tab<->tabpanel ARIA", () => {
    render(<ConversationPanel />);
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    const alertasTab = screen.getByRole("tab", { name: "Alertas" });

    // Todo (default): both a chat turn and the alert are visible.
    const todoPanel = screen.getByRole("tabpanel");
    expect(todoPanel).toHaveTextContent(/Preparando el motor/);
    expect(todoPanel).toHaveTextContent(/silenciado/);

    fireEvent.click(chatTab);
    const chatPanel = screen.getByRole("tabpanel");
    expect(chatTab).toHaveAttribute("aria-controls", chatPanel.id);
    expect(chatPanel).toHaveAttribute("aria-labelledby", chatTab.id);
    expect(chatPanel).toHaveTextContent(/Preparando el motor/);
    expect(chatPanel).not.toHaveTextContent(/silenciado/);

    fireEvent.click(alertasTab);
    const alertasPanel = screen.getByRole("tabpanel");
    expect(alertasTab).toHaveAttribute("aria-controls", alertasPanel.id);
    expect(alertasPanel).toHaveAttribute("aria-labelledby", alertasTab.id);
    expect(alertasPanel).toHaveTextContent(/silenciado/);
    expect(alertasPanel).not.toHaveTextContent(/Preparando el motor/);
  });
});
