import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  commandConflictHandler,
  commandNetworkErrorHandler,
  commandValidationHandler,
  frozenStatusHandler
} from "../test/handlers.js";
import { MemoryCard } from "./MemoryCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(MemoryCard)));
}

describe("MemoryCard populates from GET /api/memoria/stats", () => {
  it("renders the counts-only inspector with no raw chat content", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText("14")).toBeInTheDocument());
    expect(screen.getByText(/solo conteos/)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded count list", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/stats`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("MemoryCard Limpiar memoria — confirm step", () => {
  it("requires a confirm step before dispatching, and Cancelar backs out without dispatching", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () => {
        calls += 1;
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    expect(screen.getByText(/No se puede deshacer/)).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "Confirmar" });

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(calls).toBe(0);

    // re-open and actually confirm this time
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(confirmButton).toBeTruthy();
    await waitFor(() => expect(calls).toBe(1));
  });

  it("announces the destructive confirm prompt via role=alert and moves focus to Confirmar", async () => {
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/No se puede deshacer/);
    expect(screen.getByRole("button", { name: "Confirmar" })).toHaveFocus();
  });

  it("dispatches clear_history with no payload value on confirm — accepted -> poll -> applied", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST; convergence must come from the optimistic timer, not this.
    server.use(frozenStatusHandler(1));
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-clear", status: "queued", state_version: 1 });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    await waitFor(() => expect(capturedBody).toEqual({ command: "clear_history", payload: {} }));
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });
});

describe("MemoryCard clear_history errors surface honestly", () => {
  it("shows a 409 conflict alert", async () => {
    server.use(commandConflictHandler());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
  });

  it("shows a 422 validation alert", async () => {
    server.use(commandValidationHandler("unknown command"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unknown command"));
  });

  it("shows a network-error alert", async () => {
    server.use(commandNetworkErrorHandler());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Limpiar memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
