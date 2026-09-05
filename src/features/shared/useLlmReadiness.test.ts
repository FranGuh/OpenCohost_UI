import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultReadiness } from "../../test/handlers.js";
import { useLlmReadiness } from "./useLlmReadiness.js";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useLlmReadiness hook", () => {
  it("resolves steady ready local state", async () => {
    const { result } = renderHook(() => useLlmReadiness(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.state).toBe("LOCAL_READY");
    expect(result.current.canChat).toBe(true);
    expect(result.current.isReady).toBe(true);
    expect(result.current.isOllamaReachable).toBe(true);
    expect(result.current.isModelInstalled).toBe(true);
    expect(result.current.recommendedModel).toBe("qwen3:1.7b");
    expect(result.current.missingReason).toBeNull();
  });

  it("identifies LOCAL_OLLAMA_MISSING with human explanation", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_OLLAMA_MISSING",
          can_chat: false,
          ollama: { ...defaultReadiness.ollama, reachable: false, model_installed: false, error: "Connection refused" }
        })
      )
    );

    const { result } = renderHook(() => useLlmReadiness(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.state).toBe("LOCAL_OLLAMA_MISSING");
    expect(result.current.canChat).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.isOllamaReachable).toBe(false);
    expect(result.current.missingReason).toMatch(/Ollama no responde/i);
  });

  it("identifies LOCAL_OLLAMA_OFFLINE with human explanation", async () => {
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
            binary_path: "C:\\Ollama\\ollama.exe"
          }
        })
      )
    );

    const { result } = renderHook(() => useLlmReadiness(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.state).toBe("LOCAL_OLLAMA_OFFLINE");
    expect(result.current.canChat).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.isOllamaReachable).toBe(false);
    expect(result.current.isOllamaInstalled).toBe(true);
    expect(result.current.missingReason).toMatch(/servicio no responde/i);
  });

  it("identifies LOCAL_NO_MODELS with human explanation", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_NO_MODELS",
          can_chat: false,
          ollama: { ...defaultReadiness.ollama, reachable: true, installed_models: [], model_installed: false }
        })
      )
    );

    const { result } = renderHook(() => useLlmReadiness(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.state).toBe("LOCAL_NO_MODELS");
    expect(result.current.canChat).toBe(false);
    expect(result.current.isOllamaReachable).toBe(true);
    expect(result.current.isModelInstalled).toBe(false);
    expect(result.current.missingReason).toMatch(/no hay modelos descargados/i);
  });

  it("identifies LOCAL_MODEL_MISSING with model name", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_MODEL_MISSING",
          selected_model: "gemma4:e4b",
          can_chat: false,
          ollama: { ...defaultReadiness.ollama, reachable: true, installed_models: ["qwen3:1.7b"], model_installed: false }
        })
      )
    );

    const { result } = renderHook(() => useLlmReadiness(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.state).toBe("LOCAL_MODEL_MISSING");
    expect(result.current.canChat).toBe(false);
    expect(result.current.missingReason).toMatch(/gemma4:e4b/i);
  });

  it("identifies CLOUD_UNCONFIGURED with guidance", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "CLOUD_UNCONFIGURED",
          provider: "cloud",
          can_chat: false,
          cloud: { configured: false, validating: false, selected_model: null, error: "Missing API key" }
        })
      )
    );

    const { result } = renderHook(() => useLlmReadiness(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.state).toBe("CLOUD_UNCONFIGURED");
    expect(result.current.canChat).toBe(false);
    expect(result.current.missingReason).toMatch(/falta API key/i);
  });
});
