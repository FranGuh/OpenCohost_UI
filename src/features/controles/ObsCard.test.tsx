import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultObsConfig, obsConfigGetErrorHandler, obsTestFailureHandler } from "../../test/handlers.js";
import { ObsCard } from "./ObsCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ObsCard)));
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
