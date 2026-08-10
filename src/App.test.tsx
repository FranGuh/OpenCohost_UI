import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL, defaultEvents } from "./test/handlers.js";
import { server } from "./test/server.js";
import { App } from "./App.js";

const bootstrapMocks = vi.hoisted(() => ({
  bootstrapBackend: vi.fn(),
  getBackendBootstrapError: vi.fn()
}));

vi.mock("./lib/backendBootstrap.js", () => ({
  bootstrapBackend: () => bootstrapMocks.bootstrapBackend(),
  getBackendBootstrapError: () => bootstrapMocks.getBackendBootstrapError()
}));

vi.mock("./features/shell/AppLayout.js", () => ({
  AppLayout: () => React.createElement("main", null, "application shell")
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  bootstrapMocks.bootstrapBackend.mockReset();
  bootstrapMocks.getBackendBootstrapError.mockReset();
  bootstrapMocks.getBackendBootstrapError.mockReturnValue(null);
});

describe("App startup activation", () => {
  it("does not mount EventBridge until bootstrap and validated health are ready", async () => {
    const bootstrap = deferred<{ backendError: string | null }>();
    const health = deferred<boolean>();
    let healthRequests = 0;
    let eventRequests = 0;
    bootstrapMocks.bootstrapBackend.mockReturnValue(bootstrap.promise);
    server.use(
      http.get(`${API_BASE_URL}/api/health`, async () => {
        healthRequests += 1;
        return HttpResponse.json({ engine_alive: await health.promise });
      }),
      http.get(`${API_BASE_URL}/api/events`, () => {
        eventRequests += 1;
        return HttpResponse.json(defaultEvents);
      })
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(App)
      )
    );

    expect(screen.getByRole("status")).toHaveTextContent("Preparando motor local");
    expect(eventRequests).toBe(0);

    bootstrap.resolve({ backendError: null });
    await waitFor(() => expect(healthRequests).toBe(1));
    expect(screen.getByRole("status")).toHaveTextContent("Comprobando motor local");
    expect(eventRequests).toBe(0);
    expect(screen.queryByText("application shell")).not.toBeInTheDocument();

    health.resolve(true);
    await waitFor(() => expect(screen.getByText("application shell")).toBeInTheDocument());
    await waitFor(() => expect(eventRequests).toBeGreaterThan(0));
  });
});
