import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { MainStage } from "./MainStage.js";

function renderStage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MainStage, { activeSection: "experiencia" }))
  );
}

describe("MainStage — experiencia stage wired to GET /api/status", () => {
  it("shows the real current_model from status, not a hardcoded 'Qwen 3 (1.7B)'", async () => {
    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, current_model: "llama3.2:3b" })));
    renderStage();

    await waitFor(() => expect(screen.getByText(/co-host local · llama3\.2:3b/)).toBeInTheDocument());
    expect(screen.queryByText(/Qwen 3 \(1\.7B\)/)).not.toBeInTheDocument();
  });

  it("falls back to a loading label before status resolves", () => {
    renderStage();
    expect(screen.getByText(/co-host local · cargando…/)).toBeInTheDocument();
  });

  it("reflects a mocked speaking state in the now-line instead of a fixed transcript string", async () => {
    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_speaking: true })));
    renderStage();

    await waitFor(() => expect(screen.getByText(/Estado: hablando/)).toBeInTheDocument());
  });

  it("reflects a mocked processing (thinking) state in the now-line", async () => {
    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_processing: true })));
    renderStage();

    await waitFor(() => expect(screen.getByText(/Estado: pensando/)).toBeInTheDocument());
  });
});
