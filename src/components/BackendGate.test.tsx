import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { BackendGate, type BackendGateProps } from "./BackendGate.js";

function renderGate(props: Partial<Omit<BackendGateProps, "children">> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(BackendGate, {
        pollIntervalMs: 5,
        failureThreshold: 3,
        ...props,
        children: React.createElement("div", null, "app content")
      })
    )
  );
}

describe("BackendGate (WU-E: runtime backend health gate)", () => {
  it("renders children once GET /api/health returns 200", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ status: "ok" })));

    renderGate();

    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());
  });

  it("shows the splash (not the children) while the backend is not yet healthy", () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    renderGate();

    expect(screen.getByText("OpenCohost")).toBeInTheDocument();
    expect(screen.getByText(/Iniciando motor local/)).toBeInTheDocument();
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
  });

  it("switches to the error copy + Reintentar button after failureThreshold consecutive failures", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    renderGate();

    await waitFor(() => expect(screen.getByText(/No se pudo conectar con el motor local/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });

  it("Reintentar resets the failure counter and re-shows the starting splash copy", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    renderGate();
    await waitFor(() => expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Reintentar/ }));

    expect(screen.getByText(/Iniciando motor local/)).toBeInTheDocument();
  });

  it("shows the backend error detail under the generic error copy when provided", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    renderGate({ backendError: "Failed to spawn backend on port 8765: no such file or directory" });

    await waitFor(() => expect(screen.getByText(/No se pudo conectar con el motor local/)).toBeInTheDocument());
    expect(
      screen.getByText("Detalle: Failed to spawn backend on port 8765: no such file or directory")
    ).toBeInTheDocument();
  });

  it("does not render a detail line when there is no backend error", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    renderGate({ backendError: null });

    await waitFor(() => expect(screen.getByText(/No se pudo conectar con el motor local/)).toBeInTheDocument());
    expect(screen.queryByText(/Detalle:/)).not.toBeInTheDocument();
  });

  it("once healthy, never re-blocks the UI even if the backend later fails a health check", async () => {
    let healthy = true;
    server.use(
      http.get(`${API_BASE_URL}/api/health`, () => {
        if (healthy) {
          return HttpResponse.json({ status: "ok" });
        }
        return HttpResponse.json({ detail: "boom" }, { status: 500 });
      })
    );

    renderGate();
    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());

    healthy = false;
    // Give the (now-disabled) poll several intervals worth of time to prove
    // it does NOT re-trigger the gate.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText("app content")).toBeInTheDocument();
    expect(screen.queryByText("OpenCohost")).not.toBeInTheDocument();
  });
});
