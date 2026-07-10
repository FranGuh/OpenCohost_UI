import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { useWelcomeStore } from "../store/welcomeStore.js";
import { MainStage } from "./MainStage.js";

beforeEach(() => {
  window.localStorage.clear();
  useWelcomeStore.setState({ dismissed: false });
});

function renderStage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MainStage, { activeSection: "experiencia" }))
  );
}

// The "Estado: <state>" now-line renders the label in a styled <span> ("Estado: ")
// followed by the state as a sibling text node, so the combined text is split
// across elements. Match the element whose full textContent is exactly the phrase
// (and whose children don't already own it) — the RTL-recommended split-text pattern.
function combinedText(phrase: string) {
  return (_content: string, element: Element | null): boolean => {
    const owns = (el: Element | null) => el?.textContent === phrase;
    return owns(element) && Array.from(element?.children ?? []).every((child) => !owns(child));
  };
}

describe("MainStage — experiencia stage wired to GET /api/status", () => {
  it("layers Welcome inline without replacing Kira and dismisses it explicitly", () => {
    renderStage();

    expect(screen.getByRole("heading", { name: "Bienvenido a OpenCohost" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kira" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));

    expect(screen.queryByRole("heading", { name: "Bienvenido a OpenCohost" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kira" })).toBeInTheDocument();
  });

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

    await waitFor(() => expect(screen.getByText(combinedText("Estado: hablando"))).toBeInTheDocument());
  });

  it("reflects a mocked processing (thinking) state in the now-line", async () => {
    server.use(http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_processing: true })));
    renderStage();

    await waitFor(() => expect(screen.getByText(combinedText("Estado: pensando"))).toBeInTheDocument());
  });
});
