import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsPopover } from "./SettingsPopover.js";

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.density;
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.density;
});

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

  it("Compacto toggles data-density on <html> and persists it to localStorage", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const compacto = screen.getByRole("switch", { name: "Compacto" });
    expect(compacto).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.dataset.density).toBeUndefined();

    fireEvent.click(compacto);

    expect(compacto).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(window.localStorage.getItem("oc-density")).toBe("compact");
  });

  it("Mostrar logs is a client-only stub with a not-wired role=status note", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    const logs = screen.getByRole("switch", { name: "Mostrar logs" });
    expect(logs).toHaveAttribute("aria-checked", "false");

    fireEvent.click(logs);

    expect(logs).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("status")).toHaveTextContent("necesita streaming en vivo desde el backend");
  });

  it("renders the 5 Ayuda topics as collapsibles", () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole("button", { name: "Configuración" }));

    for (const title of ["Experiencia", "Controles", "Agenda", "Stream", "Música"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });
});
