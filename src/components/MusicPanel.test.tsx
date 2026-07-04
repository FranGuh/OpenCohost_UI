import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { musicLibraryGetErrorHandler, musicLibraryGetHandler } from "../test/handlers.js";
import { MusicPanel } from "./MusicPanel.js";

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MusicPanel)));
}

describe("MusicPanel library hydrates from GET /api/music/library", () => {
  it("renders a track list item with a status badge, from the GET, per track", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));
    expect(screen.getByText("ambient_drift.mp3")).toBeInTheDocument();
    expect(screen.getAllByText("OK")).toHaveLength(2);
    expect(screen.getByText("faltante")).toBeInTheDocument();
    expect(screen.getByText("inválido")).toBeInTheDocument();
  });

  it("renders a per-mood track count from the GET", async () => {
    renderPanel();
    const counts = await screen.findByTestId("music-mood-counts");
    await waitFor(() => expect(within(counts).getByText(/calm/i)).toBeInTheDocument());
    expect(within(counts).getByText((_, element) => element?.textContent === "Calm: 1")).toBeInTheDocument();
  });

  it("shows an empty-library message when GET returns no tracks", async () => {
    server.use(musicLibraryGetHandler({ tracks: [], count: 0, moods: [] }));
    renderPanel();
    await waitFor(() => expect(screen.getByText("No hay tracks todavía.")).toBeInTheDocument());
  });

  it("surfaces a GET error/503 honestly instead of a stale/hardcoded library", async () => {
    server.use(musicLibraryGetErrorHandler());
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("list", { name: "Tracks de la biblioteca" })).not.toBeInTheDocument();
  });

  it("renders Importar as a disabled not-wired affordance with a role=status note", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(4));
    const importButton = screen.getByRole("button", { name: "Importar" });
    expect(importButton).toBeDisabled();
    expect(screen.getByText(/decisión pendiente del owner/i)).toBeInTheDocument();
  });
});

describe("MusicPanel mood grid is deferred (server-side playback not implemented)", () => {
  it("renders every quick-test mood button as disabled with a blocker note", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Calm" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hype" })).toBeDisabled();
    expect(screen.getByText(/reproducción server-side no implementada/i)).toBeInTheDocument();
  });
});

