import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { API_BASE_URL, defaultLlmProvider, defaultModels, defaultReadiness } from "../../test/handlers.js";
import { server } from "../../test/server.js";
import { useWelcomeStore } from "../../store/welcomeStore.js";
import { SetupWelcomeSlot } from "../setup/SetupWelcomeSlot.js";
import { BackendGate } from "./BackendGate.js";

beforeEach(() => {
  window.localStorage.clear();
  useWelcomeStore.setState({ dismissed: false, reopenSeq: 0 });
});

describe("BackendGate configuration recovery", () => {
  it("opens the real Cloud API-key flow while the API is healthy and the engine thread is unavailable", async () => {
    const readiness = {
      ...defaultReadiness,
      state: "LOCAL_OLLAMA_OFFLINE",
      can_chat: false,
      ollama: { ...defaultReadiness.ollama, reachable: false, installed_models: [], model_installed: false },
      hardware: { ...defaultReadiness.hardware, gpu_name: null, total_vram_mb: 0 }
    };
    const engineOperations: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/health`, () =>
        HttpResponse.json({ status: "ok", engine_alive: false, engine_state: "unavailable" })
      ),
      http.get(`${API_BASE_URL}/api/setup/state`, () =>
        HttpResponse.json({ status: "pending", engine_ready: false, engine: null, show_on_start: true })
      ),
      http.get(`${API_BASE_URL}/api/llm/readiness`, () => HttpResponse.json(readiness)),
      http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json({ ...defaultLlmProvider, profiles: {} })),
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: [] })),
      http.post(`${API_BASE_URL}/api/commands`, () => {
        engineOperations.push("command");
        return HttpResponse.json({ accepted: false }, { status: 503 });
      }),
      http.post(`${API_BASE_URL}/api/models/downloads`, () => {
        engineOperations.push("download");
        return new HttpResponse(null, { status: 503 });
      })
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <BackendGate failureThreshold={1}>
          <SetupWelcomeSlot />
        </BackendGate>
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "No, solo texto" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "¿Qué tan rápido habla?" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Prueba de voz" });
    fireEvent.click(screen.getByRole("button", { name: "Reproducir voz de prueba" }));
    fireEvent.click(await screen.findByRole("button", { name: "No se oye" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Empezar" }));
    await screen.findByText("No detectada. Se usará el procesador.");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: /En la nube con tu API key/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("heading", { name: "Conecta tu proveedor" })).toBeInTheDocument();
    const key = screen.getByLabelText("API key");
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(key, { target: { value: "test-only-not-a-real-key" } });
    expect(key).toHaveValue("test-only-not-a-real-key");
    expect(screen.getByRole("button", { name: "Validar API key" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    // Configuration access must not imply inference readiness or start a local model.
    expect(queryClient.getQueryData(["llmReadiness"])).toMatchObject({ can_chat: false });
    expect(engineOperations).toEqual([]);
  });
});
