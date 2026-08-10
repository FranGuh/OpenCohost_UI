import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ProfileSwitchProvider } from "../../api/useProfileSwitch.js";
import { ControlsPanel } from "./ControlsPanel.js";

beforeEach(() => {
  window.localStorage.clear();
});

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ProfileSwitchProvider, null, React.createElement(ControlsPanel))
    )
  );
}

const GROUPS = ["Perfil y modelo", "Voz y micrófono", "Memoria y personalización", "Avatar y OBS"];

describe("ControlsPanel — collapsible group cards", () => {
  it("renders the four group headers, all open by default", () => {
    renderPanel();
    for (const group of GROUPS) {
      expect(screen.getByRole("button", { name: group })).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("still renders every grouped control card unchanged (behaviour preserved)", () => {
    renderPanel();
    // One heading per grouped sub-card proves the real cards are mounted, not restructured.
    expect(screen.getByRole("heading", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Modelo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Voz de Kira" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PTT · Push-to-Talk" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OBS" })).toBeInTheDocument();
  });

  it("persists a collapse toggle to localStorage and reflects it on the header", () => {
    renderPanel();
    const header = screen.getByRole("button", { name: "Perfil y modelo" });

    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("oc-collapse-controles-perfil-modelo")).toBe("0");
  });

  it("hydrates a group's collapsed state from localStorage on mount", () => {
    window.localStorage.setItem("oc-collapse-controles-voz-microfono", "0");
    renderPanel();

    expect(screen.getByRole("button", { name: "Voz y micrófono" })).toHaveAttribute("aria-expanded", "false");
    // Groups without a stored value stay open.
    expect(screen.getByRole("button", { name: "Perfil y modelo" })).toHaveAttribute("aria-expanded", "true");
  });
});
