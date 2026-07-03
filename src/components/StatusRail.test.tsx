import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { StatusRail } from "./StatusRail.js";

function renderRail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(StatusRail))
  );
}

describe("StatusRail (spec R2)", () => {
  it("shows a non-crashing loading placeholder before the first response resolves", () => {
    renderRail();
    expect(screen.getByText(/Cargando estado del motor/)).toBeInTheDocument();
  });

  it("renders semantic badges driven by useStatusQuery — not hardcoded", async () => {
    renderRail();

    await waitFor(() => expect(screen.getByText(/Sistema: listo/)).toBeInTheDocument());
    expect(screen.getByText(/Modelo:/)).toHaveTextContent(defaultStatus.current_model as string);
    expect(screen.getByText(/Health:/)).toHaveTextContent(defaultStatus.health.overall_status);
    expect(screen.getByText(/Voz: en silencio/)).toBeInTheDocument();
    expect(screen.getByText(/Inactivo/)).toBeInTheDocument();
    expect(screen.getByText(/Perfil:/)).toHaveTextContent(defaultStatus.active_profile);
  });

  it("reflects a different mocked response (proves it is not hardcoded)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          is_ready: false,
          current_model: null,
          is_speaking: true,
          is_processing: true,
          active_profile: "Akira",
          health: { ...defaultStatus.health, overall_status: "red" }
        })
      )
    );

    renderRail();

    await waitFor(() => expect(screen.getByText(/Sistema: no listo/)).toBeInTheDocument());
    expect(screen.getByText(/Modelo:/)).toHaveTextContent("—");
    expect(screen.getByText(/Health:/)).toHaveTextContent("red");
    expect(screen.getByText(/Voz: hablando/)).toBeInTheDocument();
    expect(screen.getByText(/Procesando/)).toBeInTheDocument();
    expect(screen.getByText(/Perfil:/)).toHaveTextContent("Akira");

    const healthBadge = screen.getByText(/Health:/);
    expect(healthBadge).toHaveAttribute("data-tone", "danger");
    const systemBadge = screen.getByText(/Sistema: no listo/);
    expect(systemBadge).toHaveAttribute("data-tone", "danger");
  });
});
