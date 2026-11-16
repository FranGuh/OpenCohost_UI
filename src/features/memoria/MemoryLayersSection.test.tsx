import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultMemoriaSettings } from "../../test/handlers.js";
import { ApiError, ValidationError } from "../../api/client.js";
import { getMemoriaSettings, postMemoriaSettings } from "../../api/memoria.js";
import { MemoryLayersSection } from "./MemoryLayersSection.js";
import { MemoryCard } from "./MemoryCard.js";

beforeEach(() => {
  window.localStorage.clear();
});

function renderWithClient(element: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, element));
}

const FACTS = "Datos guardados";
const EPISODES = "Charlas pasadas";
const SEMANTIC = "Búsqueda semántica";

describe("memoria settings API client", () => {
  it("GET /api/memoria/settings parses the layer flags", async () => {
    expect(await getMemoriaSettings()).toEqual(defaultMemoriaSettings);
  });

  it("POST sends a partial body and returns the effective flags", async () => {
    let sent: unknown = null;
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/settings`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...defaultMemoriaSettings, facts: false });
      })
    );
    const result = await postMemoriaSettings({ facts: false });
    expect(sent).toEqual({ facts: false });
    expect(result.facts).toBe(false);
  });

  it("maps 422 to ValidationError and 503 to ApiError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/settings`, () =>
        HttpResponse.json({ detail: "no memory layer provided" }, { status: 422 })
      )
    );
    await expect(postMemoriaSettings({})).rejects.toBeInstanceOf(ValidationError);

    server.use(
      http.post(`${API_BASE_URL}/api/memoria/settings`, () =>
        HttpResponse.json({ detail: "memory_settings_write_failed" }, { status: 503 })
      )
    );
    const err = await postMemoriaSettings({ facts: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("memory_settings_write_failed");
  });
});

describe("MemoryLayersSection toggles", () => {
  it("seeds the three switches from GET /api/memoria/settings", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/settings`, () =>
        HttpResponse.json({ ...defaultMemoriaSettings, episodes: false })
      )
    );
    renderWithClient(React.createElement(MemoryLayersSection));

    await waitFor(() => expect(screen.getByRole("switch", { name: FACTS })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: EPISODES })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: SEMANTIC })).toHaveAttribute("aria-checked", "true");
  });

  it("clicking a switch POSTs only that layer and reflects the server answer", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/settings`, async ({ request }) => {
        const body = (await request.json()) as Record<string, boolean>;
        bodies.push(body);
        return HttpResponse.json({ ...defaultMemoriaSettings, ...body });
      })
    );
    renderWithClient(React.createElement(MemoryLayersSection));
    await waitFor(() => expect(screen.getByRole("switch", { name: FACTS })).toBeEnabled());

    fireEvent.click(screen.getByRole("switch", { name: FACTS }));

    await waitFor(() => expect(screen.getByRole("switch", { name: FACTS })).toHaveAttribute("aria-checked", "false"));
    expect(bodies).toEqual([{ facts: false }]);
  });

  it("semantic off disables the episodes switch and explains why", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/settings`, () =>
        HttpResponse.json({ ...defaultMemoriaSettings, semantic: false })
      )
    );
    renderWithClient(React.createElement(MemoryLayersSection));

    await waitFor(() => expect(screen.getByRole("switch", { name: EPISODES })).toBeDisabled());
    expect(screen.getByRole("switch", { name: FACTS })).toBeEnabled();
    expect(screen.getByText("Requiere la búsqueda semántica.")).toBeInTheDocument();
  });

  it("master switch off disables every layer and says so", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/settings`, () =>
        HttpResponse.json({ ...defaultMemoriaSettings, memorias_enabled: false })
      )
    );
    renderWithClient(React.createElement(MemoryLayersSection));

    await waitFor(() => expect(screen.getByRole("switch", { name: FACTS })).toBeDisabled());
    expect(screen.getByRole("switch", { name: EPISODES })).toBeDisabled();
    expect(screen.getByRole("switch", { name: SEMANTIC })).toBeDisabled();
    expect(screen.getByText("La memoria está desactivada: estas opciones no tienen efecto.")).toBeInTheDocument();
  });

  it("surfaces a GET error instead of rendering fake switch states", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/memoria/settings`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    renderWithClient(React.createElement(MemoryLayersSection));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo leer la configuración de memoria.")
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("a failed save keeps the previous state and shows an error", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/settings`, () =>
        HttpResponse.json({ detail: "memory_settings_write_failed" }, { status: 503 })
      )
    );
    renderWithClient(React.createElement(MemoryLayersSection));
    await waitFor(() => expect(screen.getByRole("switch", { name: SEMANTIC })).toBeEnabled());

    fireEvent.click(screen.getByRole("switch", { name: SEMANTIC }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo guardar la configuración de memoria.")
    );
    expect(screen.getByRole("switch", { name: SEMANTIC })).toHaveAttribute("aria-checked", "true");
  });

  it("is mounted inside the memory card", async () => {
    renderWithClient(React.createElement(MemoryCard));
    await waitFor(() => expect(screen.getByRole("switch", { name: SEMANTIC })).toBeInTheDocument());
    expect(screen.getByText("Capas de memoria")).toBeInTheDocument();
  });
});
