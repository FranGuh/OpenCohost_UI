import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoriaPanel } from "./MemoriaPanel.js";

beforeEach(() => {
  window.localStorage.clear();
});

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoriaPanel)));
}

describe("MemoriaPanel — Segmented pane switcher over the three memory/personalization cards", () => {
  it("renders only the Memoria card by default, no accordion wrapper around it", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Memoria" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Personalización" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tarjetas editoriales" })).not.toBeInTheDocument();
    // No group accordion header wraps them (that was ControlsPanel's job before
    // the extraction) — a "Memoria y personalización" toggle button no longer exists.
    expect(screen.queryByRole("button", { name: "Memoria y personalización" })).not.toBeInTheDocument();
  });

  it("switching segments swaps which card is mounted — the other two are absent from the DOM, not merely hidden", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Personalización" }));
    expect(screen.getByRole("heading", { name: "Personalización" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Memoria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tarjetas editoriales" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tarjetas editoriales" }));
    expect(screen.getByRole("heading", { name: "Tarjetas editoriales" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Memoria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Personalización" })).not.toBeInTheDocument();
  });

  it("persists the selected pane across a remount (oc-memoria-pane)", () => {
    const { unmount } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Tarjetas editoriales" }));
    expect(window.localStorage.getItem("oc-memoria-pane")).toBe("editorialCards");

    unmount();
    renderPanel();

    expect(screen.getByRole("heading", { name: "Tarjetas editoriales" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Memoria" })).not.toBeInTheDocument();
  });
});
