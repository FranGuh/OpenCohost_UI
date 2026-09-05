import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultReadiness } from "../../test/handlers.js";
import { useEventStore } from "../../store/eventStore.js";
import { useLogsPrefStore } from "../../store/useLogsPref.js";
import { ConversationPanel } from "./ConversationPanel.js";

vi.mock("../../api/liveTranscript.js", () => ({
  useLiveTranscript: () => {}
}));

function renderPanel() {
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
      React.createElement(ConversationPanel)
    )
  );
}

beforeEach(() => {
  useEventStore.setState({ events: [] });
  useLogsPrefStore.setState({ showLogs: false });
});

describe("ConversationPanel LLM readiness integration & message buffering", () => {
  it("renders LlmReadinessCard in empty state when engine is unready", async () => {
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

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Asistente de Preparación LLM")).toBeInTheDocument();
    });
    expect(screen.getByText("Ollama offline")).toBeInTheDocument();
    expect(screen.getByText("Ollama no detectado")).toBeInTheDocument();
  });

  it("intercepts submit when engine is unready, buffers message, and shows recovery surface without calling turn API", async () => {
    let turnCalls = 0;
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
      ),
      http.post(`${API_BASE_URL}/api/chat/turn`, () => {
        turnCalls++;
        return HttpResponse.json({ accepted: true, turn_id: 101 });
      })
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Asistente de Preparación LLM")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/escribí un mensaje/i);
    fireEvent.change(input, { target: { value: "Mensaje de prueba" } });
    fireEvent.submit(input.closest("form")!);

    // Should NOT call the turn API
    expect(turnCalls).toBe(0);

    // Buffers message and opens recovery modal
    await waitFor(() => {
      expect(screen.getByText(/mensaje en espera del motor llm:/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Mensaje de prueba")).toBeInTheDocument();
  });

  it("cancels pending message and restores text to composer input", async () => {
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

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Asistente de Preparación LLM")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/escribí un mensaje/i);
    fireEvent.change(input, { target: { value: "Mensaje que voy a cancelar" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/mensaje en espera del motor llm:/i)).toBeInTheDocument();
    });

    const cancelBtn = screen.getByRole("button", { name: /cancelar y recuperar texto/i });
    fireEvent.click(cancelBtn);

    // Message is restored to composer input
    expect(input).toHaveValue("Mensaje que voy a cancelar");
    expect(screen.queryByText(/mensaje en espera del motor llm:/i)).not.toBeInTheDocument();
  });

  it("auto-resumes and sends pending message exactly once when engine becomes ready", async () => {
    let canChat = false;
    let turnCalls = 0;
    let sentText: string | null = null;

    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: canChat ? "LOCAL_READY" : "LOCAL_OLLAMA_MISSING",
          can_chat: canChat,
          ollama: {
            ...defaultReadiness.ollama,
            reachable: canChat,
            model_installed: canChat,
            error: canChat ? null : "offline"
          }
        })
      ),
      http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
        turnCalls++;
        const body = (await request.json()) as { text: string };
        sentText = body.text;
        return HttpResponse.json({ accepted: true, turn_id: 105 });
      })
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("Asistente de Preparación LLM")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/escribí un mensaje/i);
    fireEvent.change(input, { target: { value: "Auto-resume test message" } });
    fireEvent.submit(input.closest("form")!);

    expect(turnCalls).toBe(0);
    await waitFor(() => {
      expect(screen.getByText(/mensaje en espera del motor llm:/i)).toBeInTheDocument();
    });

    // Flip readiness to ready and trigger refetch
    canChat = true;
    // Find the refresh button inside LlmReadinessCard to trigger readiness refetch
    const refreshBtn = screen.getByRole("button", { name: /comprobar conexión/i });
    fireEvent.click(refreshBtn);

    // Auto-resume fires: send API is called exactly once with the buffered text
    await waitFor(() => {
      expect(turnCalls).toBe(1);
    });
    expect(sentText).toBe("Auto-resume test message");

    // Operator turn appears in timeline and pending banner clears
    await waitFor(() => {
      expect(screen.getByText("Auto-resume test message")).toBeInTheDocument();
      expect(screen.queryByText(/mensaje en espera del motor llm:/i)).not.toBeInTheDocument();
    });
  });
});
