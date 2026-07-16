import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// Module-scope spies referenced lazily inside the mock factory (matching the
// repo's @tauri-apps/api/core mock convention) — the closure only reads them at
// click time, so there is no temporal-dead-zone issue with vi.mock hoisting.
const minimize = vi.fn().mockResolvedValue(undefined);
const toggleMaximize = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close })
}));

import { TITLEBAR_APP_CONTROLS_SLOT_ID, TitleBar } from "./TitleBar.js";

// Stands in for AppLayout: portals a marker into the bar's app-controls slot the
// same way the real component does (id lookup after mount). Proves the bar shows
// the cluster only when something injects it — never during boot.
function AppControlsProbe({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(TITLEBAR_APP_CONTROLS_SLOT_ID));
  }, []);
  return slot ? createPortal(children, slot) : null;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("TitleBar", () => {
  it("renders the brand lockup and three window controls", () => {
    render(<TitleBar />);
    // The wordmark is split for the cyan "Cohost" — match the span by textContent.
    expect(
      screen.getByText(
        (_content, element) => element?.tagName === "SPAN" && element.textContent === "OpenCohost"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimizar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximizar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("drives the Tauri window API from each caption button", async () => {
    render(<TitleBar />);

    // Each handler dynamically import()s the mocked module and fires-and-forgets;
    // await each spy before the next click so the import settles deterministically.
    fireEvent.click(screen.getByRole("button", { name: "Minimizar" }));
    await waitFor(() => expect(minimize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Maximizar" }));
    await waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  // Ported from the absorbed TopBar so the brand-credit contract survives the merge.
  it("credits Franguh with a safe external link", () => {
    render(<TitleBar />);
    // The tagline is `hidden` below xl (jsdom applies the base display:none), so
    // include a11y-hidden nodes to assert the link's attributes regardless.
    const credit = screen.getByRole("link", { name: "Developed by Franguh", hidden: true });
    expect(credit).toHaveAttribute("href", "https://github.com/franguh");
    expect(credit).toHaveAttribute("target", "_blank");
    expect(credit).toHaveAttribute("rel", "noreferrer");
  });

  it("has no account avatar (the app has no user accounts)", () => {
    render(<TitleBar />);
    expect(screen.queryByLabelText("cuenta")).not.toBeInTheDocument();
  });

  it("shows the app-controls cluster only when injected past the gate, not during boot", () => {
    const boot = render(<TitleBar />);
    expect(screen.queryByText("status rail")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gear" })).not.toBeInTheDocument();
    boot.unmount();

    render(
      <>
        <TitleBar />
        <AppControlsProbe>
          <div>status rail</div>
          <button type="button">gear</button>
        </AppControlsProbe>
      </>
    );
    expect(screen.getByText("status rail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gear" })).toBeInTheDocument();
  });

  it("marks only background elements as drag regions, never interactive children", () => {
    const { container } = render(<TitleBar />);

    // The bar background carries the Tauri v2 drag attribute...
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();

    // ...but no interactive element does, so clicks on them never start a drag.
    const interactives = container.querySelectorAll("button, a");
    expect(interactives.length).toBeGreaterThan(0);
    interactives.forEach((el) => {
      expect(el.hasAttribute("data-tauri-drag-region")).toBe(false);
    });
  });
});
