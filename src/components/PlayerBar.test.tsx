import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
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

  it("applies the spectrum treatment to the play button only when is_speaking is true", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_speaking: true }))
    );
    renderBar();
    await waitFor(() => {
      const playButton = screen.getByRole("button", { name: "Reproducir" });
      expect(playButton.className).toContain("bg-[image:var(--spectrum)]");
    });
  });

  it("does not apply the spectrum treatment when is_speaking is false", async () => {
    renderBar();
    await waitFor(() => expect(screen.getByText(/Kira ·/)).toBeInTheDocument());
    const playButton = screen.getByRole("button", { name: "Reproducir" });
    expect(playButton.className).not.toContain("bg-[image:var(--spectrum)]");
  });

  it("shows a P2 note when a transport button is clicked", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent(/Hablar: se habilitará/);
  });
});
