import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { BackendGate, type BackendGateProps } from "./BackendGate.js";

const bootstrapMocks = vi.hoisted(() => ({
  bootstrapBackend: vi.fn(),
  getBackendBootstrapError: vi.fn()
}));

vi.mock("../../lib/backendBootstrap.js", () => ({
  bootstrapBackend: () => bootstrapMocks.bootstrapBackend(),
  getBackendBootstrapError: () => bootstrapMocks.getBackendBootstrapError()
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

beforeEach(() => {
  bootstrapMocks.bootstrapBackend.mockReset();
  bootstrapMocks.getBackendBootstrapError.mockReset();
  bootstrapMocks.bootstrapBackend.mockResolvedValue({ backendError: null });
  bootstrapMocks.getBackendBootstrapError.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BackendGate startup phases", () => {
  it("paints an accessible bootstrapping status before IPC settles and does not probe health", async () => {
    const bootstrap = deferred<{ backendError: string | null }>();
    let healthRequests = 0;
    bootstrapMocks.bootstrapBackend.mockReturnValue(bootstrap.promise);
    server.use(
      http.get(`${API_BASE_URL}/api/health`, () => {
        healthRequests += 1;
        return HttpResponse.json({ engine_alive: true });
      })
    );

    renderGate();

    expect(screen.getByRole("status")).toHaveTextContent("Preparando motor local");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(healthRequests).toBe(0);
  });

  it("shows probing status after bootstrap while validated health is pending", async () => {
    const health = deferred<boolean>();
    server.use(
      http.get(`${API_BASE_URL}/api/health`, async () =>
        HttpResponse.json({ engine_alive: await health.promise })
      )
    );

    renderGate();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Comprobando motor local"));
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
    health.resolve(true);
    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());
  });

  it("renders children only when GET /api/health returns engine_alive true", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ engine_alive: true })));

    renderGate();

    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());
  });

  it("rejects a 200 health body with engine_alive false", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ engine_alive: false })));

    renderGate({ failureThreshold: 1 });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
  });

  it("rejects a malformed 200 health body", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ status: "ok" })));

    renderGate({ failureThreshold: 1 });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("app content")).not.toBeInTheDocument();
  });
});

describe("BackendGate terminal failure and retry", () => {
  it("times out a stalled health request, aborts it, and allows retry", async () => {
    const healthSignals: AbortSignal[] = [];
    let requestCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      requestCount += 1;
      const signal = init?.signal as AbortSignal;
      healthSignals.push(signal);
      if (requestCount === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ engine_alive: true })
      } as Response);
    });

    renderGate({ failureThreshold: 1, healthTimeoutMs: 20 });

    const retryButton = await screen.findByRole("button", { name: "Reintentar" });
    expect(healthSignals[0]?.aborted).toBe(true);

    await userEvent.click(retryButton);
    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());
  });

  it("aborts an in-flight stalled health request when the gate unmounts", async () => {
    let healthSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      healthSignal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        healthSignal?.addEventListener(
          "abort",
          () => reject(healthSignal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    });
    const view = renderGate({ failureThreshold: 1, healthTimeoutMs: 1000 });
    await waitFor(() => expect(healthSignal).toBeDefined());

    view.unmount();

    await waitFor(() => expect(healthSignal?.aborted).toBe(true));
  });

  it("announces terminal failure and predictably focuses the native retry button", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    renderGate({ failureThreshold: 1 });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo conectar con el motor local");
    expect(screen.getByRole("button", { name: "Reintentar" })).toHaveFocus();
  });

  it("retries health and renders children after the engine becomes ready", async () => {
    let engineAlive = false;
    server.use(
      http.get(`${API_BASE_URL}/api/health`, () =>
        engineAlive
          ? HttpResponse.json({ engine_alive: true })
          : HttpResponse.json({ engine_alive: false })
      )
    );
    renderGate({ failureThreshold: 1 });
    const retryButton = await screen.findByRole("button", { name: "Reintentar" });

    engineAlive = true;
    await userEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());
  });

  it("shows localized safe degraded copy without the supplied raw detail", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ engine_alive: false })));

    renderGate({
      failureThreshold: 1,
      backendError: "Failed to spawn the managed local backend."
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo preparar el runtime privado.");
    expect(alert).not.toHaveTextContent("Failed to spawn the managed local backend.");
    expect(alert).not.toHaveTextContent("engine_alive");
  });

  it("once ready, never re-blocks the UI after later health failures", async () => {
    let healthy = true;
    server.use(
      http.get(`${API_BASE_URL}/api/health`, () =>
        healthy
          ? HttpResponse.json({ engine_alive: true })
          : HttpResponse.json({ detail: "boom" }, { status: 500 })
      )
    );

    renderGate();
    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());

    healthy = false;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText("app content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not begin health polling when unmounted during bootstrap", async () => {
    const bootstrap = deferred<{ backendError: string | null }>();
    let healthRequests = 0;
    bootstrapMocks.bootstrapBackend.mockReturnValue(bootstrap.promise);
    server.use(
      http.get(`${API_BASE_URL}/api/health`, () => {
        healthRequests += 1;
        return HttpResponse.json({ engine_alive: true });
      })
    );
    const view = renderGate();

    view.unmount();
    bootstrap.resolve({ backendError: null });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(healthRequests).toBe(0);
  });

  it("mounts the app under a fading splash on ready, then unmounts the splash on transitionend", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ engine_alive: true })));

    const { container } = renderGate();

    // The app is live the instant the gate is ready…
    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());
    // …while the splash overlay is still mounted, now closing (opacity-0) and
    // removed from the a11y tree so the stale boot status isn't announced.
    const overlay = container.querySelector(".z-50");
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain("opacity-0");
    expect(overlay).toHaveAttribute("aria-hidden", "true");

    fireEvent.transitionEnd(overlay as Element);

    await waitFor(() => expect(container.querySelector(".z-50")).toBeNull());
    expect(screen.getByText("app content")).toBeInTheDocument();
  });

  it("tears down the splash via the fallback timer when transitionend never fires", async () => {
    server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ engine_alive: true })));

    const { container } = renderGate();
    await waitFor(() => expect(screen.getByText("app content")).toBeInTheDocument());
    expect(container.querySelector(".z-50")).not.toBeNull();

    // jsdom runs no CSS transition, so no transitionend fires — the
    // SPLASH_FADE_MS fallback must still unmount the overlay.
    await waitFor(() => expect(container.querySelector(".z-50")).toBeNull(), { timeout: 1000 });
    expect(screen.getByText("app content")).toBeInTheDocument();
  });

  it("cleans up the health polling interval on unmount", async () => {
    let healthRequests = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/health`, () => {
        healthRequests += 1;
        return HttpResponse.json({ engine_alive: false });
      })
    );
    const view = renderGate({ failureThreshold: 100 });
    await waitFor(() => expect(healthRequests).toBeGreaterThan(0));

    view.unmount();
    const requestsAtUnmount = healthRequests;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(healthRequests).toBe(requestsAtUnmount);
  });
});
