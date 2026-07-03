import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsPopover } from "./SettingsPopover.js";

describe("SettingsPopover", () => {
  it("is closed by default with aria-expanded false and no panel in the DOM", () => {
    render(<SettingsPopover />);
    const trigger = screen.getByRole("button", { name: "Configuración" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
  });

  it("opens the panel on trigger click and marks aria-expanded true", () => {
    render(<SettingsPopover />);
    const trigger = screen.getByRole("button", { name: "Configuración" });

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<SettingsPopover />);
    const trigger = screen.getByRole("button", { name: "Configuración" });
    fireEvent.click(trigger);
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
  });

  it("closes on outside click", () => {
    render(
      <div>
        <SettingsPopover />
        <button type="button">afuera</button>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
    expect(screen.getByRole("group", { name: "Tema" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "afuera" }));

    expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
  });
});
