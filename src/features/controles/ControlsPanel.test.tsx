import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("ControlsPanel — PaneSwitcher over the three settings groups", () => {
  it("renders a Segmented switcher (aria-pressed), not the old accordion (aria-expanded)", () => {
    renderPanel();
    const segment = screen.getByRole("button", { name: "Perfil y modelo" });
    expect(segment).toHaveAttribute("aria-pressed", "true");
    expect(segment).not.toHaveAttribute("aria-expanded");
  });

  it("defaults to Perfil y modelo — its pane is visible, the other two are hidden (all three stay mounted)", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Modelo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proveedor LLM" })).toBeInTheDocument();

    expect(screen.getByTestId("controles-pane-identity")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-voice")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-avatar")).toHaveAttribute("hidden");

    // Mounted, not absent — this is the load-bearing difference from a
    // conditional-render pane: a real DOM node backs the hidden headings.
    // `hidden: true` opts into RTL's role query returning them despite being
    // correctly excluded from the accessibility tree — see the plain
    // getByTestId(...) assertions above for the actual "still mounted" proof.
    expect(screen.getByRole("heading", { name: "Voz de Kira", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avatar", hidden: true })).toBeInTheDocument();
  });

  it("switching to Voz y micrófono flips which pane is hidden, without unmounting the others", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Voz y micrófono" }));

    expect(screen.getByTestId("controles-pane-voice")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-identity")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-avatar")).toHaveAttribute("hidden");

    expect(screen.getByRole("heading", { name: "Voz de Kira" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PTT · Push-to-Talk" })).toBeInTheDocument();
    // Identity is now the hidden pane — still mounted, so its heading is only
    // reachable with `hidden: true` (see the comment in the test above).
    expect(screen.getByRole("heading", { name: "Perfil", hidden: true })).toBeInTheDocument();
  });

  it("switching to Avatar y OBS flips which pane is hidden again", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Avatar y OBS" }));

    expect(screen.getByTestId("controles-pane-avatar")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-identity")).toHaveAttribute("hidden");
    expect(screen.getByTestId("controles-pane-voice")).toHaveAttribute("hidden");

    expect(screen.getByRole("heading", { name: "Avatar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OBS" })).toBeInTheDocument();
  });

  it("a typed ObsCard Host draft survives a pane round trip (Avatar → Perfil → Avatar) — the regression this change guards", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Avatar y OBS" }));
    await waitFor(() => expect(screen.getByLabelText("Host")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "192.168.1.77" } });
    expect(screen.getByLabelText("Host")).toHaveValue("192.168.1.77");

    fireEvent.click(screen.getByRole("button", { name: "Perfil y modelo" }));
    fireEvent.click(screen.getByRole("button", { name: "Avatar y OBS" }));

    expect(screen.getByLabelText("Host")).toHaveValue("192.168.1.77");
  });

  it("persists the selected pane across a remount (oc-controles-pane)", () => {
    const { unmount } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Avatar y OBS" }));
    expect(window.localStorage.getItem("oc-controles-pane")).toBe("avatar");

    unmount();
    renderPanel();

    expect(screen.getByRole("heading", { name: "Avatar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Perfil" })).not.toBeInTheDocument();
  });
});
