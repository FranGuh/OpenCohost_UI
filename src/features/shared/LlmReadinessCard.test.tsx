import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultReadiness, makeDownloadJob } from "../../test/handlers.js";
import { LlmReadinessCard, type LlmReadinessCardProps } from "./LlmReadinessCard.js";

function renderCard(props: LlmReadinessCardProps = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(LlmReadinessCard, props)
    )
  );
}

describe("LlmReadinessCard component", () => {
  it("renders ready state with hardware details and recommended command", async () => {
    renderCard();

    await waitFor(() => expect(screen.getByText("El motor LLM está listo para chatear.")).toBeInTheDocument());

    // Title and status
    expect(screen.getByText("Asistente de Preparación LLM")).toBeInTheDocument();

    // Hardware summary
    expect(screen.getByText("NVIDIA GeForce RTX 5060")).toBeInTheDocument();
    expect(screen.getByText("8.0 GB")).toBeInTheDocument();

    // Recommended command
    expect(screen.getByText("ollama run qwen3:1.7b")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copiar comando/i })).toBeInTheDocument();
  });

  it("renders when Ollama is offline with download link and offline alert", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_OLLAMA_MISSING",
          can_chat: false,
          ollama: {
            ...defaultReadiness.ollama,
            reachable: false,
            model_installed: false,
            error: "Connection refused"
          }
        })
      )
    );

    renderCard();

    await waitFor(() => expect(screen.getByText("Ollama offline")).toBeInTheDocument());
    expect(screen.getByText("Ollama no detectado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /https:\/\/ollama\.com\/download/i })).toHaveAttribute(
      "href",
      "https://ollama.com/download"
    );
  });

  it("renders when Ollama is reachable but has no models installed", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_NO_MODELS",
          can_chat: false,
          ollama: {
            ...defaultReadiness.ollama,
            reachable: true,
            model_installed: false,
            installed_models: []
          }
        })
      )
    );

    renderCard();

    await waitFor(() => expect(screen.getByText("Sin modelos")).toBeInTheDocument());
    expect(screen.getByText("Ollama activo pero sin modelos")).toBeInTheDocument();
  });

  it("copies run command to clipboard and shows copied feedback", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    renderCard();

    await waitFor(() => expect(screen.getByText("El motor LLM está listo para chatear.")).toBeInTheDocument());

    const copyBtn = screen.getByRole("button", { name: /copiar comando/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith("ollama run qwen3:1.7b");
    await waitFor(() => expect(screen.getByText(/copiado/i)).toBeInTheDocument());
  });

  it("switches to cloud tab and displays API key inputs", async () => {
    renderCard();

    await waitFor(() => expect(screen.getByText("El motor LLM está listo para chatear.")).toBeInTheDocument());

    const cloudTab = screen.getByRole("button", { name: "Modo Nube (API)" });
    fireEvent.click(cloudTab);

    const addBtn = await screen.findByRole("button", { name: /\+ Añadir proveedor/i });
    fireEvent.click(addBtn);

    expect(screen.getByLabelText("Proveedor Cloud")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar y Activar" })).toBeDisabled();
  });

  it("calls onClose when dismiss button is clicked with showDismiss", async () => {
    const handleClose = vi.fn();
    renderCard({ showDismiss: true, onClose: handleClose });

    await waitFor(() => expect(screen.getByText("El motor LLM está listo para chatear.")).toBeInTheDocument());

    const closeBtn = screen.getByRole("button", { name: "Cerrar" });
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("renders when Ollama is installed but daemon is offline (LOCAL_OLLAMA_OFFLINE)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_OLLAMA_OFFLINE",
          can_chat: false,
          ollama: {
            ...defaultReadiness.ollama,
            reachable: false,
            binary_found: true,
            binary_path: "C:\\Users\\tavo_\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
            in_path: false
          }
        })
      )
    );

    renderCard();

    await waitFor(() => expect(screen.getByText("Ollama detenido")).toBeInTheDocument());
    expect(screen.getByText("Ollama instalado pero detenido")).toBeInTheDocument();
    expect(screen.getByText(/ollama serve/i)).toBeInTheDocument();
    expect(screen.getByText(/variable PATH/i)).toBeInTheDocument();
  });

  it("displays configured cloud profiles and allows activating and deleting them", async () => {
    let capturedPutBody: any = null;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedPutBody = await request.json();
        return HttpResponse.json({
          active_provider: capturedPutBody?.active_provider ?? "local",
          fallback_mode: "auto",
          pregen_enabled: false,
          profiles: {
            openai: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", preset: "openai", api_key_set: true }
          }
        });
      })
    );

    renderCard();
    await waitFor(() => expect(screen.getByText("El motor LLM está listo para chatear.")).toBeInTheDocument());

    // Switch to Cloud tab
    fireEvent.click(screen.getByRole("button", { name: "Modo Nube (API)" }));

    // Verify configured profile is listed
    await waitFor(() => expect(screen.getByText(/Proveedores configurados/i)).toBeInTheDocument());
    expect(screen.getAllByText("OpenAI")[0]).toBeInTheDocument();
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();

    // Click Activar on the profile
    const activateBtn = screen.getByRole("button", { name: "Activar" });
    fireEvent.click(activateBtn);
    await waitFor(() => expect(capturedPutBody).toEqual({ active_provider: "openai" }));

    // Click Eliminar on the profile
    const deleteBtn = screen.getByRole("button", { name: "Eliminar perfil openai" });
    fireEvent.click(deleteBtn);
    await waitFor(() => expect(capturedPutBody).toEqual({ delete_profile: "openai" }));
  });
});


describe("LlmReadinessCard in-app download (T4)", () => {
  it.each(["LOCAL_NO_MODELS", "LOCAL_MODEL_MISSING"])(
    "%s offers a primary 'download recommended model' button and keeps the command as fallback",
    async (state) => {
      server.use(
        http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
          HttpResponse.json({
            ...defaultReadiness,
            state,
            can_chat: false,
            ollama: { ...defaultReadiness.ollama, reachable: true, model_installed: false, installed_models: [] }
          })
        )
      );
      let postedTag = "";
      server.use(
        http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
          postedTag = ((await request.json()) as { tag: string }).tag;
          return HttpResponse.json(makeDownloadJob({ tag: postedTag, state: "queued" }), { status: 202 });
        })
      );

      renderCard();

      const button = await screen.findByRole("button", { name: "Descargar modelo recomendado (qwen3:1.7b)" });
      expect(screen.getByText("ollama run qwen3:1.7b")).toBeInTheDocument();
      fireEvent.click(button);
      await waitFor(() => expect(postedTag).toBe("qwen3:1.7b"));
    }
  );

  it("does not offer the download button when ready", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText("El motor LLM está listo para chatear.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Descargar modelo recomendado/ })).not.toBeInTheDocument();
  });
});

describe("LlmReadinessCard no-Ollama guidance (T5)", () => {
  function serveReadiness(state: string, reachable: boolean) {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () => {
        calls += 1;
        return HttpResponse.json({
          ...defaultReadiness,
          state,
          can_chat: false,
          ollama: { ...defaultReadiness.ollama, reachable, model_installed: false }
        });
      })
    );
    return () => calls;
  }

  it("LOCAL_OLLAMA_MISSING: clear message, download link and a 'Check again' that re-fetches readiness", async () => {
    const calls = serveReadiness("LOCAL_OLLAMA_MISSING", false);
    renderCard();

    expect(
      await screen.findByText(/Para usar modelos locales necesitas Ollama/)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ollama\.com\/download/ })).toHaveAttribute("href", "https://ollama.com/download");
    await waitFor(() => expect(calls()).toBeGreaterThanOrEqual(1));
    const before = calls();
    fireEvent.click(screen.getByRole("button", { name: "Comprobar de nuevo" }));
    await waitFor(() => expect(calls()).toBeGreaterThan(before), { timeout: 400 });
    expect(screen.queryByRole("button", { name: /Descargar modelo recomendado/ })).not.toBeInTheDocument();
  });

  it("LOCAL_OLLAMA_OFFLINE: start hint and a 'Check again' that re-fetches readiness", async () => {
    const calls = serveReadiness("LOCAL_OLLAMA_OFFLINE", false);
    renderCard();

    expect(await screen.findByText(/Abre Ollama desde el menú Inicio/)).toBeInTheDocument();
    await waitFor(() => expect(calls()).toBeGreaterThanOrEqual(1));
    const before = calls();
    fireEvent.click(screen.getByRole("button", { name: "Comprobar de nuevo" }));
    await waitFor(() => expect(calls()).toBeGreaterThan(before), { timeout: 400 });
  });
});
