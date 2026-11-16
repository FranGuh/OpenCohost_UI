import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { TavilyCard } from "./TavilyCard.js";

const canary = "tvly-UI-CANARY-not-real";
const empty = { api_key_set: false, stored_key_set: false, source: "none", storage_available: true };
const saved = { ...empty, api_key_set: true, stored_key_set: true, source: "keyring" };

function renderCard(status = empty) {
  server.use(http.get(`${API_BASE_URL}/api/web-fetch/tavily`, () => HttpResponse.json(status)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: Infinity } } });
  render(React.createElement(QueryClientProvider, { client }, React.createElement(TavilyCard)));
  return client;
}

afterEach(() => vi.restoreAllMocks());

describe("TavilyCard", () => {
  it("shows_presence_without_rehydrating_key", async () => {
    renderCard(saved);
    expect(await screen.findByText("Clave guardada en el sistema.")).toBeInTheDocument();
    expect(screen.getByLabelText("Clave API de Tavily")).toHaveValue("");
    expect(screen.getByLabelText("Clave API de Tavily")).toHaveAttribute("type", "password");
  });

  it.each([true, false])("saves_write_only_and_clears_after_success_or_failure (%s)", async (success) => {
    server.use(http.put(`${API_BASE_URL}/api/web-fetch/tavily`, async ({ request }) => {
      expect(await request.json()).toEqual({ api_key: canary });
      return HttpResponse.json(success ? saved : { detail: canary }, { status: success ? 200 : 503 });
    }));
    const client = renderCard();
    const input = await screen.findByLabelText("Clave API de Tavily");
    fireEvent.change(input, { target: { value: canary } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar clave" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(await screen.findByText(success ? "Clave guardada; no se ha probado con Tavily." : "No se pudo guardar o quitar la clave.")).toBeInTheDocument();
    await waitFor(() => expect(JSON.stringify(client.getMutationCache().getAll().map(m => m.state))).not.toContain(canary));
    expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data))).not.toContain(canary);
    expect(document.body.textContent).not.toContain(canary);
  });

  it("removes_stored_key_without_hiding_environment_override", async () => {
    const env = { ...saved, source: "environment" };
    server.use(http.put(`${API_BASE_URL}/api/web-fetch/tavily`, async ({ request }) => {
      expect(await request.json()).toEqual({ api_key: "" });
      return HttpResponse.json({ ...env, stored_key_set: false });
    }));
    renderCard(env);
    await screen.findByText("La variable de entorno tiene prioridad.");
    fireEvent.click(screen.getByRole("button", { name: "Quitar clave guardada" }));
    await screen.findByText("Clave guardada eliminada; la configuración del entorno no cambia.");
    expect(screen.getByText("La variable de entorno tiene prioridad.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar clave guardada" })).toBeDisabled();
  });

  it("unavailable_storage_does_not_report_saved", async () => {
    renderCard({ ...empty, storage_available: false });
    await screen.findByText("El almacenamiento seguro no está disponible.");
    expect(screen.getByRole("button", { name: "Guardar clave" })).toBeDisabled();
    expect(screen.queryByText("Clave guardada en el sistema.")).not.toBeInTheDocument();
  });

  it("does_not_store_key_or_probe_provider", async () => {
    const requests: string[] = [];
    const listener = ({ request }: { request: Request }) => { requests.push(request.url); };
    server.events.on("request:start", listener);
    const local = vi.spyOn(Storage.prototype, "setItem");
    try {
      server.use(http.put(`${API_BASE_URL}/api/web-fetch/tavily`, () => HttpResponse.json(saved)));
      renderCard();
      fireEvent.change(await screen.findByLabelText("Clave API de Tavily"), { target: { value: canary } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar clave" }));
      await screen.findByText("Clave guardada; no se ha probado con Tavily.");
      expect(local.mock.calls.some(args => JSON.stringify(args).includes(canary))).toBe(false);
      expect(requests).toHaveLength(2);
      expect(requests.every(url => url === `${API_BASE_URL}/api/web-fetch/tavily`)).toBe(true);
    } finally { server.events.removeListener("request:start", listener); }
  });

  it("renders_external_link_to_tavily_with_utm_source", async () => {
    renderCard();
    const link = await screen.findByRole("link", { name: /Ir a Tavily/i });
    expect(link).toHaveAttribute("href", "https://www.tavily.com/?utm_source=opencohost");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("invokes openExternalUrl when clicking the external link", async () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderCard();
    const link = await screen.findByRole("link", { name: /Ir a Tavily/i });
    fireEvent.click(link);
    expect(windowOpenSpy).toHaveBeenCalledWith("https://www.tavily.com/?utm_source=opencohost", "_blank", "noreferrer");
  });
});
