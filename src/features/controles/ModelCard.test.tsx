import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  cloudModels,
  commandConflictHandler,
  commandNetworkErrorHandler,
  commandValidationHandler,
  defaultModels,
  defaultReadiness,
  evolvingCurrentModelHandler,
  makeDownloadJob
} from "../../test/handlers.js";
import { useEventStore } from "../../store/eventStore.js";
import { ModelCard } from "./ModelCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ModelCard)));
}

/** Switch the model CustomSelect to `optionName`. Mirrors ProviderCard.test.tsx's pickActiveProvider. */
function pickModel(optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Modelo Activo" }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("ModelCard populates from GET /api/models", () => {
  it("shows the live current_model and catalog options", async () => {
    renderCard();

    await waitFor(() => expect(screen.getAllByText(defaultModels.current_model as string).length).toBeGreaterThan(0));

    expect(screen.getByRole("combobox", { name: "Modelo Activo" })).toHaveTextContent("Qwen 3 (1.7B) ⚡");

    fireEvent.click(screen.getByRole("combobox", { name: "Modelo Activo" }));
    expect(screen.getByRole("option", { name: "Qwen 3 (1.7B) ⚡" })).toBeInTheDocument();

    expect(screen.getByText("instalado")).toBeInTheDocument();
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded catalog", async () => {
    server.use(http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("ModelCard switch_model — accepted -> poll -> applied", () => {
  it("dispatches switch_model, disables only the select while pending, converges on current_model match", async () => {
    server.use(evolvingCurrentModelHandler("qwen3:1.7b", "llama3.2:3b", 1));
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-model", status: "queued", state_version: 1 })
      )
    );
    renderCard();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));

    pickModel("LLaMA 3.2 (3B)");

    expect(trigger).toHaveTextContent("LLaMA 3.2 (3B)");
    expect(trigger).toBeDisabled();
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    await waitFor(() => expect(trigger).not.toBeDisabled());
    await waitFor(() => expect(screen.getByText("instalado")).toBeInTheDocument());
  });
});

describe("ModelCard command errors surface honestly", () => {
  it("shows a 409 conflict alert and re-enables the control", async () => {
    server.use(commandConflictHandler());
    renderCard();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));
    pickModel("LLaMA 3.2 (3B)");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
    expect(screen.getByRole("combobox", { name: "Modelo Activo" })).not.toBeDisabled();
  });

  it("shows a 422 validation alert with the backend detail", async () => {
    server.use(commandValidationHandler("switch_model requires a non-None string value"));
    renderCard();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));
    pickModel("LLaMA 3.2 (3B)");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("switch_model requires a non-None string value")
    );
  });

  it("shows a network-error alert", async () => {
    server.use(commandNetworkErrorHandler());
    renderCard();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));
    pickModel("LLaMA 3.2 (3B)");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("ModelCard engine-reported switch failure", () => {
  it("shows an alert when the engine reports model_switch_failed and re-enables the control", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-model-fail", status: "queued", state_version: 1 })
      )
    );
    renderCard();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));
    pickModel("LLaMA 3.2 (3B)");
    await waitFor(() => expect(trigger).toBeDisabled());

    act(() => {
      useEventStore.getState().append({
        id: "evt-model-switch-failed",
        ts: Date.now(),
        source: "motor",
        action: "model_switch_failed",
        label: "Fallo al cambiar modelo",
        tone: "danger"
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("El motor no pudo aplicar el modelo")
    );
    expect(screen.getByRole("combobox", { name: "Modelo Activo" })).not.toBeDisabled();
  });
});

describe("ModelCard in-app downloads (ADR-063 supersedes 'Ollama downloads, not OpenCohost')", () => {
  it("offers no catalog download button when every catalog entry is installed", async () => {
    renderCard();
    const trigger = await screen.findByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));

    expect(screen.queryByRole("button", { name: /^Descargar / })).not.toBeInTheDocument();
  });

  it("gives an uninstalled catalog entry a Download button that starts a job", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: ["qwen3:1.7b"] }))
    );
    let postedTag = "";
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
        postedTag = ((await request.json()) as { tag: string }).tag;
        return HttpResponse.json(makeDownloadJob({ tag: postedTag, state: "queued" }), { status: 202 });
      })
    );
    renderCard();

    const button = await screen.findByRole("button", { name: "Descargar LLaMA 3.2 (3B)" });
    expect(screen.getByRole("button", { name: "Descargar Gemma 4 (E4B)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descargar Qwen 3 (1.7B) ⚡" })).not.toBeInTheDocument();

    fireEvent.click(button);
    await waitFor(() => expect(postedTag).toBe("llama3.2:3b"));
  });

  it("shows the active-download message on 409", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: ["qwen3:1.7b"] })),
      http.post(`${API_BASE_URL}/api/models/downloads`, () =>
        HttpResponse.json({ detail: "download_active", active_job_id: "job-1" }, { status: 409 })
      )
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Descargar LLaMA 3.2 (3B)" }));
    expect(
      await screen.findByText("Ya hay una descarga en curso. Espera a que termine o cancélala.")
    ).toBeInTheDocument();
  });

  it("hosts the Hugging Face field", async () => {
    renderCard();
    expect(await screen.findByLabelText("Repositorio de Hugging Face")).toBeInTheDocument();
  });
});

describe("ModelCard availability marking from `discovered` and readiness", () => {
  it("marks a not-installed catalog entry as disabled and refuses to select it", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: ["qwen3:1.7b"] })),
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_MODEL_MISSING",
          ollama: { ...defaultReadiness.ollama, installed_models: ["qwen3:1.7b"] }
        })
      )
    );
    renderCard();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));
    fireEvent.click(trigger);

    const missingOption = screen.getByRole("option", { name: /LLaMA 3\.2 \(3B\) — no instalado/ });
    expect(missingOption).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(missingOption);

    // Disabled option click neither closes the list nor fires a command.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.queryByText("aplicando…")).not.toBeInTheDocument();
  });

  it("marks all catalog options as not installed and warns when Ollama is running with zero models", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: [] })),
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_NO_MODELS",
          can_chat: false,
          ollama: { ...defaultReadiness.ollama, reachable: true, installed_models: [], model_installed: false }
        })
      )
    );
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Ollama está activo pero no hay modelos descargados/i)).toBeInTheDocument()
    );
    expect(screen.getByText("sin modelos")).toBeInTheDocument();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent(/Qwen 3/));
    fireEvent.click(trigger);

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    options.forEach((option) => {
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(option).toHaveTextContent(/no instalado/);
    });
  });

  it("surfaces connection alert and disables options when Ollama is offline", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: [] })),
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_OLLAMA_MISSING",
          can_chat: false,
          ollama: { reachable: false, installed_models: [], selected_model: null, model_installed: false, error: "offline" }
        })
      )
    );
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Ollama no responde o no está en ejecución/i)).toBeInTheDocument()
    );
    expect(screen.getByText("sin conexión")).toBeInTheDocument();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    fireEvent.click(trigger);

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    options.forEach((option) => {
      expect(option).toHaveAttribute("aria-disabled", "true");
    });
  });

  it("toggles the embedded setup assistant card when Ollama is offline", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: [] })),
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({
          ...defaultReadiness,
          state: "LOCAL_OLLAMA_MISSING",
          can_chat: false,
          ollama: { reachable: false, installed_models: [], selected_model: null, model_installed: false, error: "offline" }
        })
      )
    );
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Ollama no responde o no está en ejecución/i)).toBeInTheDocument()
    );

    const openBtn = screen.getByRole("button", { name: /abrir asistente de configuración/i });
    expect(openBtn).toBeInTheDocument();

    fireEvent.click(openBtn);
    expect(screen.getByText("Asistente de Preparación LLM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ocultar asistente/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ocultar asistente/i }));
    expect(screen.queryByText("Asistente de Preparación LLM")).not.toBeInTheDocument();
  });

  it("lists an owner-pulled tag outside the curated catalog as a plain selectable option", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () =>
        HttpResponse.json({ ...defaultModels, discovered: [...defaultModels.discovered, "mistral:7b"] })
      )
    );
    renderCard();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));
    fireEvent.click(trigger);

    expect(screen.getByRole("option", { name: "mistral:7b" })).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("ModelCard cloud mode — read-only pointer to Proveedor LLM (owner: Ollama-only discovery)", () => {
  it("shows the active cloud model with no select, no tiers, and no Ollama hint", async () => {
    server.use(http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json(cloudModels)));
    renderCard();

    await waitFor(() => expect(screen.getAllByText(cloudModels.current_model as string).length).toBeGreaterThan(0));
    expect(screen.getByText(/Proveedor LLM/)).toBeInTheDocument();
    expect(screen.getByText("en la nube")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ollama/)).not.toBeInTheDocument();
    expect(screen.queryByText("CONTEXTO")).not.toBeInTheDocument();
  });
});

describe("ModelCard reasoning mode controls", () => {
  it("renders reasoning controls when active model is reasoning, allows toggle and budget selection", async () => {
    let putPayload: any = null;
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () =>
        HttpResponse.json({
          ...defaultModels,
          current_model: "qwen3:1.7b",
          is_reasoning_active: true,
          reasoning_config: { enabled: false, budget_tokens: null }
        })
      ),
      http.put(`${API_BASE_URL}/api/models/reasoning`, async ({ request }) => {
        putPayload = await request.json();
        return HttpResponse.json({ enabled: putPayload.enabled, budget_tokens: putPayload.budget_tokens ?? null });
      })
    );

    renderCard();

    // Verify header and toggle
    await waitFor(() => expect(screen.getByText("MODO RAZONAMIENTO")).toBeInTheDocument());
    const toggle = screen.getByRole("switch", { name: /Pensamiento interno/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");

    // Fast hint is visible when thinking is disabled
    expect(screen.getByText(/Pensamiento desactivado: respuestas instantáneas/i)).toBeInTheDocument();
    expect(screen.queryByText("PRESUPUESTO DE TOKENS")).not.toBeInTheDocument();

    // Toggle switch ON
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(putPayload).toMatchObject({ enabled: true });

    // When ON, the auto-first budget section appears: Automático by default
    // (T2/T3, controls-cleanup-adaptive-reasoning-20260928 — no exposed
    // 256/512/1024/2048 selector anymore, same pattern as CONTEXTO).
    expect(screen.getByText("PRESUPUESTO DE TOKENS")).toBeInTheDocument();
    expect(screen.getByText("Automático (adaptativo)")).toBeInTheDocument();
    expect(
      screen.getByText(/El motor ajusta el presupuesto de tokens automáticamente/i)
    ).toBeInTheDocument();
  });

  it("does not render reasoning controls when model is non-reasoning and not marked active", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () =>
        HttpResponse.json({
          ...defaultModels,
          current_model: "llama3.2:3b",
          is_reasoning_active: false,
          reasoning_config: { enabled: false, budget_tokens: null }
        })
      )
    );

    renderCard();

    await waitFor(() => expect(screen.getAllByText("llama3.2:3b").length).toBeGreaterThan(0));
    expect(screen.queryByText("MODO RAZONAMIENTO")).not.toBeInTheDocument();
  });
});

describe("ModelCard context control (auto-first, active model only)", () => {
  it("shows Automático with the effective token count for the active model by default", async () => {
    renderCard();

    await waitFor(() => expect(screen.getByText("CONTEXTO")).toBeInTheDocument());
    expect(screen.getByText("Automático · 16384 tokens")).toBeInTheDocument();
    expect(screen.queryByText(/Personalizado/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tokens de contexto")).not.toBeInTheDocument();
  });

  it("hides the section when context_config belongs to a different model than the active one", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () =>
        HttpResponse.json({
          ...defaultModels,
          current_model: "llama3.2:3b",
          context_config: { ...defaultModels.context_config, model: "qwen3:1.7b" }
        })
      )
    );

    renderCard();

    await waitFor(() => expect(screen.getAllByText("llama3.2:3b").length).toBeGreaterThan(0));
    expect(screen.queryByText("CONTEXTO")).not.toBeInTheDocument();
  });

  it("Personalizar reveals a numeric override input with auto/native hints and a VRAM warning", async () => {
    renderCard();

    await waitFor(() => expect(screen.getByText("CONTEXTO")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Personalizar" }));

    const input = screen.getByLabelText("Tokens de contexto") as HTMLInputElement;
    expect(input).toHaveValue(16384);
    expect(input).toHaveAttribute("min", "2048");
    expect(input).toHaveAttribute("max", "131072");
    expect(screen.getByText(/Automático usaría 16384 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Máximo nativo del modelo: 262144 tokens/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText(/consumir toda la VRAM libre restante \(4096 MB libres de 8192 MB\)/)
      ).toBeInTheDocument()
    );
  });

  it("saves a manual override via PUT /api/models/context and switches to the Personalizado view", async () => {
    // Explicit baseline: the built-in PUT /api/models/context handler
    // (test/handlers.ts) persists into this shared fixture, mirroring the
    // real backend's durable write — so the round trip below (save -> query
    // invalidation -> refetch) reflects the saved value, not a mock that
    // only echoes the request back without persisting it.
    defaultModels.context_config = {
      model: "qwen3:1.7b",
      context_tokens: null,
      auto_context_tokens: 16384,
      native_context: 262144,
      effective_context: 16384,
      policy: "auto"
    };

    renderCard();

    await waitFor(() => expect(screen.getByText("CONTEXTO")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Personalizar" }));

    const input = screen.getByLabelText("Tokens de contexto");
    fireEvent.change(input, { target: { value: "32768" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(defaultModels.context_config).toMatchObject({
        model: "qwen3:1.7b",
        context_tokens: 32768,
        policy: "requested"
      })
    );
    await waitFor(() => expect(screen.getByText("Personalizado · 32768 tokens")).toBeInTheDocument());
    expect(screen.queryByLabelText("Tokens de contexto")).not.toBeInTheDocument();
  });

  it("Volver a automático clears the override via PUT with context_tokens: null", async () => {
    // Same persisting built-in handler as above — seed an already-customized
    // baseline so the reset round trip (PUT null -> refetch -> Automático)
    // is observed against a real persisted change, not an echoed mock.
    defaultModels.context_config = {
      model: "qwen3:1.7b",
      context_tokens: 32768,
      auto_context_tokens: 16384,
      native_context: 262144,
      effective_context: 32768,
      policy: "requested"
    };

    renderCard();

    await waitFor(() => expect(screen.getByText("Personalizado · 32768 tokens")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Volver a automático" }));

    await waitFor(() =>
      expect(defaultModels.context_config).toMatchObject({ context_tokens: null, policy: "auto" })
    );
    await waitFor(() => expect(screen.getByText("Automático · 16384 tokens")).toBeInTheDocument());
  });
});

describe("ModelCard reasoning budget control (auto-first, T2/T3 controls-cleanup-adaptive-reasoning-20260928)", () => {
  // Declared LAST in this file deliberately: these tests seed and persist
  // into the shared `defaultModels.reasoning_config` singleton via the
  // built-in PUT /api/models/reasoning handler (test/handlers.ts), the same
  // real-persistence idiom the CONTEXTO round-trip tests above use. Placing
  // this block after every other describe keeps that mutation from leaking
  // backward into unrelated tests declared earlier in this file.
  // Scoped to the reasoning section (`within`): the active model here
  // (qwen3:1.7b) also has a CONTEXTO section on screen at the same time,
  // and both sections use the same "Personalizar"/"Volver a automático"
  // button copy by design (T3 mirrors CONTEXTO's exact pattern) — an
  // unscoped query would be genuinely ambiguous, not a test bug.
  function reasoningSection(): HTMLElement {
    return screen.getByText("MODO RAZONAMIENTO").closest("section") as HTMLElement;
  }

  it("Personalizar reveals a numeric cap input with truthful copy (a max, not the actual value)", async () => {
    defaultModels.reasoning_config = { enabled: true, budget_tokens: null };
    renderCard();

    await waitFor(() => expect(screen.getByText("Automático (adaptativo)")).toBeInTheDocument());
    fireEvent.click(within(reasoningSection()).getByRole("button", { name: "Personalizar" }));

    const input = screen.getByLabelText("Tokens de presupuesto") as HTMLInputElement;
    expect(input).toHaveAttribute("min", "32");
    expect(input).toHaveAttribute("max", "8192");
    expect(
      screen.getByText(/tope máximo: el motor sigue adaptando el presupuesto por debajo de él/i)
    ).toBeInTheDocument();
  });

  it("saves a manual cap via PUT /api/models/reasoning and switches to the Tope manual view", async () => {
    defaultModels.reasoning_config = { enabled: true, budget_tokens: null };
    renderCard();

    await waitFor(() => expect(screen.getByText("Automático (adaptativo)")).toBeInTheDocument());
    fireEvent.click(within(reasoningSection()).getByRole("button", { name: "Personalizar" }));

    const input = screen.getByLabelText("Tokens de presupuesto");
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.click(within(reasoningSection()).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(defaultModels.reasoning_config).toMatchObject({ enabled: true, budget_tokens: 300 })
    );
    await waitFor(() => expect(screen.getByText("Tope manual · 300 tokens")).toBeInTheDocument());
    expect(screen.queryByLabelText("Tokens de presupuesto")).not.toBeInTheDocument();
  });

  it("Volver a automático clears the cap via PUT with budget_tokens: null", async () => {
    defaultModels.reasoning_config = { enabled: true, budget_tokens: 300 };
    renderCard();

    await waitFor(() => expect(screen.getByText("Tope manual · 300 tokens")).toBeInTheDocument());
    fireEvent.click(within(reasoningSection()).getByRole("button", { name: "Volver a automático" }));

    await waitFor(() =>
      expect(defaultModels.reasoning_config).toMatchObject({ enabled: true, budget_tokens: null })
    );
    await waitFor(() => expect(screen.getByText("Automático (adaptativo)")).toBeInTheDocument());
  });

  it("rejects empty or whitespace input for reasoning budget and context tokens without sending 0", async () => {
    defaultModels.reasoning_config = { enabled: true, budget_tokens: null };
    defaultModels.context_config = {
      model: "qwen3:1.7b",
      context_tokens: null,
      auto_context_tokens: 16384,
      native_context: 262144,
      effective_context: 16384,
      policy: "auto"
    };
    let reasoningPuts = 0;
    let contextPuts = 0;
    server.use(
      http.put(`${API_BASE_URL}/api/models/reasoning`, () => {
        reasoningPuts += 1;
        return HttpResponse.json({ enabled: true, budget_tokens: 0 });
      }),
      http.put(`${API_BASE_URL}/api/models/context`, () => {
        contextPuts += 1;
        return HttpResponse.json({ ...defaultModels.context_config, context_tokens: 0, policy: "requested" });
      })
    );
    renderCard();

    await waitFor(() => expect(screen.getByText("CONTEXTO")).toBeInTheDocument());

    fireEvent.click(within(reasoningSection()).getByRole("button", { name: "Personalizar" }));
    const budgetInput = screen.getByLabelText("Tokens de presupuesto");
    for (const blank of ["", "   "]) {
      fireEvent.change(budgetInput, { target: { value: blank } });
      await act(async () => {
        fireEvent.click(within(reasoningSection()).getByRole("button", { name: "Guardar" }));
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      expect(screen.getByLabelText("Tokens de presupuesto")).toBeInTheDocument();
    }

    const contextSection = screen.getByText("CONTEXTO").closest("section") as HTMLElement;
    fireEvent.click(within(contextSection).getByRole("button", { name: "Personalizar" }));
    const contextInput = screen.getByLabelText("Tokens de contexto");
    for (const blank of ["", "   "]) {
      fireEvent.change(contextInput, { target: { value: blank } });
      await act(async () => {
        fireEvent.click(within(contextSection).getByRole("button", { name: "Guardar" }));
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      expect(screen.getByLabelText("Tokens de contexto")).toBeInTheDocument();
    }

    expect(reasoningPuts).toBe(0);
    expect(contextPuts).toBe(0);
  });

  it("keeps optimistic reasoning and context values visible until invalidated GET /api/models settles", async () => {
    const initialPayload = {
      ...defaultModels,
      current_model: "qwen3:1.7b",
      is_reasoning_active: true,
      reasoning_config: { enabled: true, budget_tokens: 300 as number | null },
      context_config: {
        model: "qwen3:1.7b",
        context_tokens: 32768 as number | null,
        auto_context_tokens: 16384,
        native_context: 262144,
        effective_context: 32768,
        policy: "requested" as "auto" | "requested"
      }
    };
    const afterContextResetPayload = {
      ...initialPayload,
      context_config: {
        ...initialPayload.context_config,
        context_tokens: null,
        effective_context: 16384,
        policy: "auto" as "auto" | "requested"
      }
    };
    const afterReasoningResetPayload = {
      ...afterContextResetPayload,
      reasoning_config: { enabled: true, budget_tokens: null }
    };

    let currentPayload = initialPayload;
    let getCalls = 0;
    let pendingGate: Promise<void> | null = null;
    let releaseGate: (() => void) | null = null;
    function armGate() {
      pendingGate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
    }
    function openGate() {
      pendingGate = null;
      const fn = releaseGate;
      releaseGate = null;
      fn?.();
    }

    server.use(
      http.get(`${API_BASE_URL}/api/models`, async () => {
        getCalls += 1;
        if (pendingGate) await pendingGate;
        return HttpResponse.json(currentPayload);
      }),
      http.put(`${API_BASE_URL}/api/models/context`, () => HttpResponse.json(afterContextResetPayload.context_config)),
      http.put(`${API_BASE_URL}/api/models/reasoning`, () =>
        HttpResponse.json(afterReasoningResetPayload.reasoning_config)
      )
    );

    renderCard();
    await waitFor(() => expect(screen.getByText("Personalizado · 32768 tokens")).toBeInTheDocument());

    const contextSection = screen.getByText("CONTEXTO").closest("section") as HTMLElement;
    const callsBeforeContext = getCalls;
    currentPayload = afterContextResetPayload;
    armGate();
    fireEvent.click(within(contextSection).getByRole("button", { name: "Volver a automático" }));

    // PUT settled immediately while GET refetch is suspended -> optimistic "Automático" and pending state MUST hold!
    await waitFor(() => expect(getCalls).toBeGreaterThan(callsBeforeContext));
    expect(within(contextSection).getByText(/^Automático ·/)).toBeInTheDocument();
    expect(within(contextSection).getByRole("button", { name: "Personalizar" })).toBeDisabled();
    expect(screen.queryByText("Personalizado · 32768 tokens")).not.toBeInTheDocument();

    openGate();
    await waitFor(() =>
      expect(within(contextSection).getByRole("button", { name: "Personalizar" })).toBeEnabled()
    );
    expect(screen.getByText("Automático · 16384 tokens")).toBeInTheDocument();

    // Same contract for reasoning budget: optimistic "Automático" and pending state MUST hold until GET refetch settles!
    const callsBeforeReasoning = getCalls;
    currentPayload = afterReasoningResetPayload;
    armGate();
    fireEvent.click(within(reasoningSection()).getByRole("button", { name: "Volver a automático" }));

    await waitFor(() => expect(getCalls).toBeGreaterThan(callsBeforeReasoning));
    expect(screen.getByText("Automático (adaptativo)")).toBeInTheDocument();
    expect(within(reasoningSection()).getByRole("button", { name: "Personalizar" })).toBeDisabled();
    expect(screen.queryByText("Tope manual · 300 tokens")).not.toBeInTheDocument();

    openGate();
    await waitFor(() =>
      expect(within(reasoningSection()).getByRole("button", { name: "Personalizar" })).toBeEnabled()
    );
    expect(screen.getByText("Automático (adaptativo)")).toBeInTheDocument();
  });
});

describe("ModelCard explicit loading / activation feedback (S3)", () => {
  it("shows a spinner and activating status when switching models, and keeps 'Usar este modelo' visible as 'Activando…'", async () => {
    let downloads = {
      jobs: [makeDownloadJob({ id: "job-done", tag: "llama3.2:3b", state: "completed", phase: "success", percent: 100, installed: true })],
      active_job_id: null,
      max_retries: 3
    };
    server.use(
      evolvingCurrentModelHandler("qwen3:1.7b", "llama3.2:3b", 2),
      http.get(`${API_BASE_URL}/api/models/downloads`, () => HttpResponse.json(downloads)),
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-model", status: "queued", state_version: 1 })
      )
    );
    renderCard();

    const trigger = await screen.findByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));
    const useBtn = await screen.findByRole("button", { name: "Usar este modelo" });
    fireEvent.click(useBtn);

    expect(trigger).toHaveAttribute("aria-busy", "true");
    expect(trigger.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByText("Activando LLaMA 3.2 (3B)…")).toBeInTheDocument();
    const pendingBadge = screen.getByText("aplicando…").closest("span");
    expect(pendingBadge?.querySelector("svg.animate-spin")).not.toBeNull();

    const activatingBtn = screen.getByRole("button", { name: "Activando…" });
    expect(activatingBtn).toBeDisabled();
    expect(activatingBtn.querySelector("svg.animate-spin")).not.toBeNull();

    await waitFor(() => expect(trigger).not.toBeDisabled());
  });

  it("shows a spinner and starting text on the clicked Download button while POST /api/models/downloads is in flight", async () => {
    let releaseDownload!: () => void;
    const gate = new Promise<void>((resolve) => { releaseDownload = resolve; });
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: ["qwen3:1.7b"] })),
      http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
        await gate;
        const { tag } = (await request.json()) as { tag: string };
        return HttpResponse.json(makeDownloadJob({ tag, state: "queued" }), { status: 202 });
      })
    );
    renderCard();

    const llamaBtn = await screen.findByRole("button", { name: "Descargar LLaMA 3.2 (3B)" });
    const gemmaBtn = screen.getByRole("button", { name: "Descargar Gemma 4 (E4B)" });
    fireEvent.click(llamaBtn);

    await waitFor(() => expect(llamaBtn).toBeDisabled());
    expect(gemmaBtn).toBeDisabled();
    expect(llamaBtn).toHaveTextContent("Iniciando…");
    expect(llamaBtn.querySelector("svg.animate-spin")).not.toBeNull();
    expect(gemmaBtn).toHaveTextContent("Descargar");

    releaseDownload();
    await waitFor(() => expect(llamaBtn).toBeEnabled());
  });
});
