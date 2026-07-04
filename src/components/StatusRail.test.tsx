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

    await waitFor(() => expect(screen.getByText(/Sistema: OK/)).toBeInTheDocument());
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

    await waitFor(() => expect(screen.getByText(/Sistema: error/)).toBeInTheDocument());
    expect(screen.getByText(/Modelo:/)).toHaveTextContent("—");
    expect(screen.getByText(/Health:/)).toHaveTextContent("red");
    expect(screen.getByText(/Voz: hablando/)).toBeInTheDocument();
    expect(screen.getByText(/Procesando/)).toBeInTheDocument();
    expect(screen.getByText(/Perfil:/)).toHaveTextContent("Akira");

    const healthBadge = screen.getByText(/Health:/);
    expect(healthBadge).toHaveAttribute("data-tone", "danger");
    const systemBadge = screen.getByText(/Sistema: error/);
    expect(systemBadge).toHaveAttribute("data-tone", "danger");
    // Names the worst dimension driving the rollup — health, not readiness.
    expect(systemBadge).toHaveTextContent("salud");
  });

  it("rolls up an all-OK payload as Sistema: OK (no degraded dimension)", async () => {
    renderRail();
    await waitFor(() => expect(screen.getByText(/Sistema: OK/)).toBeInTheDocument());
    const systemBadge = screen.getByText(/Sistema: OK/);
    expect(systemBadge).toHaveAttribute("data-tone", "ok");
    expect(systemBadge).not.toHaveTextContent("·");
  });

  it("rolls up a not-ready model (health OK) as a WARN naming 'modelo'", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, is_ready: false })
      )
    );
    renderRail();
    await waitFor(() => expect(screen.getByText(/Sistema: alerta/)).toBeInTheDocument());
    const systemBadge = screen.getByText(/Sistema: alerta/);
    expect(systemBadge).toHaveAttribute("data-tone", "warn");
    expect(systemBadge).toHaveTextContent("modelo");
  });

  it("rolls up health=yellow (model ready) as a WARN naming 'salud'", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, health: { ...defaultStatus.health, overall_status: "yellow" } })
      )
    );
    renderRail();
    await waitFor(() => expect(screen.getByText(/Sistema: alerta/)).toBeInTheDocument());
    const systemBadge = screen.getByText(/Sistema: alerta/);
    expect(systemBadge).toHaveAttribute("data-tone", "warn");
    expect(systemBadge).toHaveTextContent("salud");
  });

  it("shows a warming badge when ollama_warming is true and the model isn't ready", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, is_ready: false, ollama_warming: true })
      )
    );
    renderRail();
    await waitFor(() => expect(screen.getByText(/calentando/)).toBeInTheDocument());
  });

  it("does not show the warming badge when ollama_warming is false or absent", async () => {
    renderRail();
    await waitFor(() => expect(screen.getByText(/Sistema: OK/)).toBeInTheDocument());
    expect(screen.queryByText(/calentando/)).not.toBeInTheDocument();
  });

  it("rolls up health=unknown as a neutral QUIET pill — no crit/warn input degrades", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, health: { ...defaultStatus.health, overall_status: "unknown" } })
      )
    );
    renderRail();
    await waitFor(() => expect(screen.getByText(/Sistema: \.\.\./)).toBeInTheDocument());
    const systemBadge = screen.getByText(/Sistema: \.\.\./);
    expect(systemBadge).toHaveAttribute("data-tone", "neutral");
  });
});
