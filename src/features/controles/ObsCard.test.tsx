import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultObsConfig, obsConfigGetErrorHandler, obsTestFailureHandler } from "../../test/handlers.js";
import { OBS_CONFIG_QUERY_KEY } from "../../api/obs.js";
import { ObsCard } from "./ObsCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ObsCard)))
  };
}

describe("ObsCard populates from GET /api/obs/config", () => {
  it("hydrates host/port/source and the enable toggle from the fetched config", async () => {
    renderCard();

    await waitFor(() => expect(screen.getByLabelText("Host")).toHaveValue(defaultObsConfig.host));
    expect(screen.getByLabelText("Puerto")).toHaveValue(String(defaultObsConfig.port));
    expect(screen.getByLabelText("Fuente")).toHaveValue(defaultObsConfig.source);
    expect(screen.getByRole("switch", { name: "Habilitar OBS" })).toHaveAttribute(
      "aria-checked",
      String(defaultObsConfig.enabled)
    );
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded config", async () => {
    server.use(obsConfigGetErrorHandler());
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
  });
});

describe("ObsCard Guardar PUTs the edited config", () => {
  it("fires PUT /api/obs/config with host/port/source/enabled, and omits password when none typed", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/obs/config`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultObsConfig, host: "192.168.1.5" });
      })
    );
    renderCard();

    await screen.findByLabelText("Host");
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "192.168.1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        enabled: defaultObsConfig.enabled,
        host: "192.168.1.5",
        port: defaultObsConfig.port,
        source: defaultObsConfig.source
      })
    );
  });

  it("includes password in the PUT body only when the operator typed one", async () => {
    let capturedBody: any;
    server.use(
      http.put(`${API_BASE_URL}/api/obs/config`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(defaultObsConfig);
      })
    );
    renderCard();

    await screen.findByLabelText("Host");
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(capturedBody?.password).toBe("s3cr3t"));
  });

  it("never echoes a saved password back into the rendered password field", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/obs/config`, () => HttpResponse.json({ ...defaultObsConfig, password_set: true }))
    );
    renderCard();

    await screen.findByLabelText("Host");
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
  });
});

describe("ObsCard Probar conexión fires POST /api/obs/test", () => {
  it("renders an ok result", async () => {
    renderCard();
    await screen.findByLabelText("Host");

    fireEvent.click(screen.getByRole("button", { name: "Probar conexión" }));

    await waitFor(() => expect(screen.getByText(/conexión exitosa/i)).toBeInTheDocument());
  });

  it("renders a color-coded failure result with the returned error", async () => {
    server.use(obsTestFailureHandler("connection refused"));
    renderCard();
    await screen.findByLabelText("Host");

    fireEvent.click(screen.getByRole("button", { name: "Probar conexión" }));

    await waitFor(() => expect(screen.getByText("connection refused")).toBeInTheDocument());
  });
});

describe("ObsCard toggle persistence, dirty refetch guard, and port validation", () => {
  it("persists the Habilitar OBS switch immediately via PUT /api/obs/config and reverts on error", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.put(`${API_BASE_URL}/api/obs/config`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultObsConfig, enabled: true });
      })
    );
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "Habilitar OBS" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    await waitFor(() => expect(capturedBody).toEqual({ enabled: true }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));

    // Next toggle fails on backend -> reverts back to persisted state and surfaces an alert.
    server.use(
      http.put(`${API_BASE_URL}/api/obs/config`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("does not clobber unsaved Host/Port/Source edits when a background GET refetch completes", async () => {
    let serverHost = defaultObsConfig.host;
    server.use(
      http.get(`${API_BASE_URL}/api/obs/config`, () =>
        HttpResponse.json({ ...defaultObsConfig, host: serverHost })
      )
    );
    const { queryClient } = renderCard();

    const hostInput = await screen.findByLabelText("Host");
    fireEvent.change(hostInput, { target: { value: "192.168.1.99" } });

    serverHost = "10.0.0.1";
    await queryClient.invalidateQueries({ queryKey: OBS_CONFIG_QUERY_KEY });
    await waitFor(() => {
      const cached = queryClient.getQueryData<{ host: string }>(OBS_CONFIG_QUERY_KEY);
      expect(cached?.host).toBe("10.0.0.1");
    });

    expect(screen.getByLabelText("Host")).toHaveValue("192.168.1.99");
  });

  it("rejects empty, non-numeric, or out-of-range ports (1..65535) on Guardar and Probar conexión without hitting the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderCard();
    await screen.findByLabelText("Host");
    fetchSpy.mockClear();

    const portInput = screen.getByLabelText("Puerto");
    for (const badPort of ["", "   ", "0", "65536", "4455.5", "abc"]) {
      fireEvent.change(portInput, { target: { value: badPort } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      expect(screen.getByRole("alert")).toHaveTextContent(/1\.\.65535|1 y 65535|1 and 65535/i);

      fireEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
      expect(screen.getByRole("alert")).toHaveTextContent(/1\.\.65535|1 y 65535|1 and 65535/i);
    }

    const mutationCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/api/obs/config") || String(url).includes("/api/obs/test")
    );
    expect(mutationCalls).toEqual([]);
  });
});
