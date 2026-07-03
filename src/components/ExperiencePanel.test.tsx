import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { ExperiencePanel } from "./ExperiencePanel.js";

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ExperiencePanel))
  );
}

describe("ExperiencePanel", () => {
  it("shows the default preset transcript message", () => {
    renderPanel();
    expect(screen.getByText(/Preparando el motor/)).toBeInTheDocument();
  });

  it("renders the idle avatar when the engine is ready and idle", async () => {
    renderPanel();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/idle.png");
    });
  });

  it("switches to the speaking avatar when is_speaking is true", async () => {
    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_speaking: true })));
    renderPanel();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/speaking.png");
    });
  });

  it("switches to the thinking avatar when is_processing is true", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_processing: true }))
    );
    renderPanel();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/thinking.png");
    });
  });

  it("switches to the error avatar when health.overall_status is red", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, health: { ...defaultStatus.health, overall_status: "red" } })
      )
    );
    renderPanel();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/error.png");
    });
  });

  it("switches to the sleeping avatar when the engine is not ready (and health is not red)", async () => {
    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_ready: false })));
    renderPanel();
    await waitFor(() => {
      const img = screen.getByRole("img", { name: /Avatar de Kira/ }) as HTMLImageElement;
      expect(img.src).toContain("/avatar/sleeping.png");
    });
  });

  it("renders the composer preview and shows a P2 note instead of sending", () => {
    renderPanel();
    const input = screen.getByPlaceholderText("Escribí un mensaje para Kira…");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Enviar: se habilitará/);
  });

  it("shows a P2 note when Hablar is clicked", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Hablar" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Hablar: se habilitará/);
  });
});
