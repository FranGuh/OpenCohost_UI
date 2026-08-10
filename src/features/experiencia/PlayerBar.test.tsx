import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultStatus, lastReplyHandler } from "../../test/handlers.js";
import { PlayerBar } from "./PlayerBar.js";

function renderBar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PlayerBar))
  );
}

describe("PlayerBar", () => {
  it("gives every transport button an accessible label", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Push-to-talk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reproducir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detener" })).toBeInTheDocument();
  });

  it("applies the brand accent-grad treatment to the play button only when is_speaking is true", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_speaking: true }))
    );
    renderBar();
    await waitFor(() => {
      const playButton = screen.getByRole("button", { name: "Reproducir" });
      expect(playButton.className).toContain("bg-[image:var(--accent-grad)]");
    });
  });

  it("does not apply the accent-grad treatment when is_speaking is false", async () => {
    renderBar();
    await waitFor(() => expect(screen.getByText(/Kira ·/)).toBeInTheDocument());
    const playButton = screen.getByRole("button", { name: "Reproducir" });
    expect(playButton.className).not.toContain("bg-[image:var(--accent-grad)]");
  });

  it("shows a neutral idle label instead of a canned transcript when no reply has landed yet", async () => {
    renderBar();
    expect(await screen.findByText("Sin reproducción en curso")).toBeInTheDocument();
  });

  it("shows Kira's fetched reply as the now-playing label once one lands", async () => {
    server.use(lastReplyHandler({ text: "ese clip estuvo brutal", turn_id: 1 }));
    renderBar();
    expect(await screen.findByText("ese clip estuvo brutal")).toBeInTheDocument();
  });

  it("shows a P2 note when a transport button is clicked", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent(/Hablar: se habilitará/);
  });
});
