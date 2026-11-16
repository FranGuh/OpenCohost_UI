import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultSetupState, defaultLlmProvider, defaultModels, defaultReadiness, defaultStatus } from "../../test/handlers.js";
import { useEventStore } from "../../store/eventStore.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import type { LlmReadinessResponse, ModelsResponse } from "../../api/client.js";
import type { ModelDownloadsResponse } from "../../api/modelDownloads.js";
import { SetupFlow, type SetupFlowProps } from "./SetupFlow.js";
import { NARRATOR_MUTED_KEY } from "./narratorPref.js";

const catalog = {
  "qwen3:1.7b": { display: "Qwen 3 (1.7B)", desc: "Muy pequeño.", size_gb: 1.4, family: "qwen3", min_vram_gb: 0 },
  "qwen3:4b": { display: "Qwen 3 (4B)", desc: "Pequeño.", size_gb: 2.5, family: "qwen3", min_vram_gb: 4 },
  "gemma4:e4b": { display: "Gemma 4 (E4B)", desc: "Grande.", size_gb: 9.6, family: "gemma", min_vram_gb: 10 }
};

const noProfiles = { ...defaultLlmProvider, profiles: {} };

function cpuReadiness(installed: string[]): LlmReadinessResponse {
  return {
    ...defaultReadiness,
    ollama: { ...defaultReadiness.ollama, reachable: true, installed_models: installed },
    hardware: {
      ...defaultReadiness.hardware,
      gpu_name: null,
      total_vram_mb: 0,
      cpu_only: true,
      recommended_tag: "qwen3:1.7b"
    } as LlmReadinessResponse["hardware"]
  };
}

function useFixtures({ readiness, models }: { readiness: LlmReadinessResponse; models?: Partial<ModelsResponse> }) {
  server.use(
    http.get(`${API_BASE_URL}/api/llm/readiness`, () => HttpResponse.json(readiness)),
    // No saved cloud profiles unless a test adds them: the BYOK step opens on the create form.
    http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(noProfiles)),
    http.get(`${API_BASE_URL}/api/models`, () =>
      HttpResponse.json({ ...defaultModels, catalog, discovered: readiness.ollama.installed_models, ...models })
    )
  );
}

/** Records the text of every POST /api/speech/say. */
function captureSpeech(): string[] {
  const said: string[] = [];
  server.use(
    http.post(`${API_BASE_URL}/api/speech/say`, async ({ request }) => {
      said.push(((await request.json()) as { text: string }).text);
      return HttpResponse.json({ job_id: said.length });
    })
  );
  return said;
}

function renderFlow(props: Partial<SetupFlowProps> = {}) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <SetupFlow variant="modal" onClose={onClose} onComplete={onComplete} {...props} />
    </QueryClientProvider>
  );
  render(ui);
  return { onClose, onComplete, queryClient };
}

function next(name: RegExp | string = "Continuar") {
  fireEvent.click(screen.getByRole("button", { name }));
}

async function toVoiceTest(heard: "Sí, te escucho" | "No se oye" = "Sí, te escucho") {
  await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
  next();
  await screen.findByRole("heading", { name: "¿Qué tan rápido habla?" });
  next();
  await screen.findByRole("heading", { name: "Prueba de voz" });
  fireEvent.click(screen.getByRole("button", { name: "Reproducir voz de prueba" }));
  fireEvent.click(await screen.findByRole("button", { name: heard }));
}

async function start(heard: "Sí, te escucho" | "No se oye" = "Sí, te escucho") {
  // UI language, Kira speech language, hear-Kira, early voice block, then welcome summary.
  await screen.findByRole("heading", { name: "Idioma · Language" });
  next();
  await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
  next();
  await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
  if (screen.getByRole("button", { name: "Continuar" }).hasAttribute("disabled")) {
    fireEvent.click(screen.getByRole("button", { name: "Sí, quiero escucharla" }));
  }
  next();
  await toVoiceTest(heard);
  next();
  await screen.findByRole("heading", { name: "Vamos a dejar a Kira lista" });
  next("Empezar");
}

async function skipPersonalize() {
  await screen.findByRole("heading", { name: "¿Quieres personalizar a Kira ahora?" });
  fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
}

async function goToEngine() {
  await start();
  await screen.findByRole("heading", { name: "Tu PC" });
  await screen.findByText("No detectada. Se usará el procesador.");
  next();
  await screen.findByRole("heading", { name: "¿Cómo quieres que piense Kira?" });
}

beforeEach(() => {
  window.localStorage.clear();
  useUiLocaleStore.getState().setLocale("es");
});

describe("SetupFlow — local Ollama prerequisite", () => {
  function unavailable(state = "LOCAL_OLLAMA_MISSING", binaryFound?: boolean): LlmReadinessResponse {
    return {
      ...cpuReadiness([]), state, can_chat: false,
      ollama: { reachable: false, installed_models: [], ...(binaryFound === undefined ? {} : { binary_found: binaryFound }) }
    };
  }

  it.each([false, undefined])("explains confirmed missing Ollama (binary evidence: %s) and reaches API-key entry without local side effects", async (binaryFound) => {
    useFixtures({ readiness: unavailable("LOCAL_OLLAMA_MISSING", binaryFound) });
    const writes: string[] = [];
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, () => { writes.push("provider"); return HttpResponse.json(noProfiles); }),
      http.post(`${API_BASE_URL}/api/models/downloads`, () => { writes.push("download"); return HttpResponse.json({}); }),
      http.post(`${API_BASE_URL}/api/commands`, () => { writes.push("command"); return HttpResponse.json({}); })
    );
    renderFlow();
    await goToEngine();
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/No encontré Ollama/);
    expect(notice).toHaveTextContent(/Instálalo y toca Volver a detectar/);
    const cpu = screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ });
    expect(cpu).toBeDisabled();
    expect(cpu).not.toHaveTextContent("Recomendado");
    expect(screen.getByRole("button", { name: /En la nube con tu API key/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /En la nube con tu API key/ }));
    next();
    await screen.findByLabelText("API key");
    expect(writes).toEqual([]);
  });

  it.each([
    ["LOCAL_OLLAMA_OFFLINE", undefined],
    ["CLOUD_READY", true]
  ] as const)("distinguishes installed-but-offline Ollama from %s and directs the user to start its service", async (state, binaryFound) => {
    useFixtures({ readiness: { ...unavailable(state, binaryFound), provider: state === "CLOUD_READY" ? "cloud" : "local" } });
    renderFlow();
    await start();
    await screen.findByText("Instalado, pero apagado");
    expect(screen.queryByText(/No encontré Ollama/)).not.toBeInTheDocument();
    next();
    await screen.findByRole("heading", { name: "¿Cómo quieres que piense Kira?" });
    expect(screen.getByRole("status")).toHaveTextContent(/Ábrelo y toca Volver a detectar/);
    expect(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /En la nube con tu API key/ })).toBeEnabled();
  });

  it.each(["CLOUD_READY", "CHECKING"])("does not invent missing Ollama from an unprobed %s response", async (state) => {
    const readiness = { ...unavailable(state), provider: state === "CLOUD_READY" ? "cloud" : "local", can_chat: state === "CLOUD_READY" };
    useFixtures({ readiness });
    renderFlow();
    await start();
    await screen.findByText("No detectada. Se usará el procesador.");
    expect(screen.queryByText("No encontrado")).not.toBeInTheDocument();
    next();
    await screen.findByRole("heading", { name: "¿Cómo quieres que piense Kira?" });
    expect(screen.getByRole("status")).toHaveTextContent(/Todavía no sé si Ollama está listo/);
    const cpu = screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ });
    expect(cpu).toBeEnabled();
    expect(cpu).not.toHaveTextContent("Recomendado");
    expect(screen.queryByText(/Ollama no se encontró/)).not.toBeInTheDocument();
  });

  it("keeps a chosen CPU engine, blocks stale advancement, and restores it when Ollama recovers", async () => {
    const ready = cpuReadiness(["qwen3:1.7b"]);
    useFixtures({ readiness: ready });
    const { queryClient } = renderFlow();
    await goToEngine();
    const cpu = screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ });
    expect(cpu).toHaveTextContent("Recomendado");
    fireEvent.click(cpu);
    act(() => queryClient.setQueryData(["llmReadiness"], unavailable("LOCAL_OLLAMA_MISSING", false)));
    await waitFor(() => expect(cpu).toBeDisabled());
    expect(cpu).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /En la nube con tu API key/ })).toHaveAttribute("aria-pressed", "false");
    act(() => queryClient.setQueryData(["llmReadiness"], ready));
    await waitFor(() => expect(cpu).toBeEnabled());
    expect(cpu).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("keeps availability unknown while the first readiness read is loading", async () => {
    let finishRead!: (value: LlmReadinessResponse) => void;
    const pending = new Promise<LlmReadinessResponse>((resolve) => { finishRead = resolve; });
    server.use(http.get(`${API_BASE_URL}/api/llm/readiness`, async () => HttpResponse.json(await pending)));
    renderFlow();
    await start();
    await screen.findByText("Revisando tu equipo…");
    next();
    await screen.findByRole("heading", { name: "¿Cómo quieres que piense Kira?" });
    expect(screen.getByRole("status")).toHaveTextContent(/Todavía no sé si Ollama está listo/);
    expect(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ })).not.toHaveTextContent("Recomendado");
    finishRead(cpuReadiness([]));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("shows the same prerequisite and temporary cloud path in English", async () => {
    useUiLocaleStore.getState().setLocale("en");
    useFixtures({ readiness: unavailable("LOCAL_OLLAMA_MISSING", false) });
    renderFlow();
    next("Continue");
    await screen.findByRole("heading", { name: "Which language will Kira speak?" });
    next("Continue");
    await screen.findByRole("heading", { name: "Shall we hear Kira?" });
    fireEvent.click(screen.getByRole("button", { name: "No, text only" }));
    next("Continue");
    await screen.findByRole("heading", { name: "Which voice do you prefer?" });
    next("Continue");
    await screen.findByRole("heading", { name: "How fast should she talk?" });
    next("Continue");
    await screen.findByRole("heading", { name: "Voice test" });
    fireEvent.click(screen.getByRole("button", { name: "Play test voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "No sound" }));
    next("Continue");
    await screen.findByRole("heading", { name: "Let's get Kira ready" });
    next("Start");
    await screen.findByText("Not found");
    next("Continue");
    await screen.findByRole("heading", { name: "How should Kira think?" });
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't find Ollama/i);
    expect(screen.getByRole("status")).toHaveTextContent(/Install it and press Check again/i);
  });
});

describe("SetupFlow — model download availability", () => {
  function unavailable(state: string, binaryFound?: boolean): LlmReadinessResponse {
    return {
      ...cpuReadiness([]),
      state,
      provider: state === "CLOUD_READY" ? "cloud" : "local",
      can_chat: state === "CLOUD_READY",
      ollama: { reachable: false, installed_models: [], ...(binaryFound === undefined ? {} : { binary_found: binaryFound }) }
    };
  }

  async function goToLocalModel() {
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ }));
    next();
    await screen.findByRole("heading", { name: "Elige un modelo" });
  }

  async function goToCloudKey() {
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En la nube con tu API key/ }));
    next();
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });
  }

  function validateCloudKey(readiness: LlmReadinessResponse) {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () => HttpResponse.json(readiness)),
      http.put(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(noProfiles))
    );
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));
  }

  it.each([
    ["LOCAL_OLLAMA_MISSING", false, /No encontré Ollama/i],
    ["LOCAL_OLLAMA_OFFLINE", true, /Ollama está instalado, pero no está abierto/i]
  ] as const)("explains %s and prevents manual model-download enqueue", async (state, binaryFound, guidance) => {
    useFixtures({ readiness: cpuReadiness([]) });
    const requests: string[] = [];
    server.use(http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
      requests.push(((await request.json()) as { tag: string }).tag);
      return HttpResponse.json({});
    }));
    const { queryClient } = renderFlow();
    await goToLocalModel();

    act(() => queryClient.setQueryData(["llmReadiness"], unavailable(state, binaryFound)));

    const download = screen.getByRole("button", { name: "Descargar" });
    expect(await screen.findByRole("status")).toHaveTextContent(guidance);
    expect(screen.getByRole("status")).toHaveTextContent(/API key/i);
    expect(download).toBeDisabled();
    expect(requests).toEqual([]);
  });

  it("allows an explicit download with unprobed cloud readiness and shows the backend Ollama failure", async () => {
    useFixtures({ readiness: unavailable("CLOUD_READY") });
    const requests: string[] = [];
    server.use(http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
      requests.push(((await request.json()) as { tag: string }).tag);
      return HttpResponse.json({ detail: "ollama_unreachable" }, { status: 503 });
    }));
    renderFlow();
    await goToLocalModel();

    expect(screen.getByRole("status")).toHaveTextContent(/No sé todavía si Ollama está listo/);
    expect(screen.queryByText(/Ollama no se encontró/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descargar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Ollama/i);
    expect(requests).toEqual(["qwen3:1.7b"]);
  });

  it("starts a manual download when Ollama is ready", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    const requests: string[] = [];
    server.use(http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
      requests.push(((await request.json()) as { tag: string }).tag);
      return HttpResponse.json({ id: "job-1", tag: "qwen3:1.7b", state: "queued" });
    }));
    renderFlow();
    await goToLocalModel();

    fireEvent.click(screen.getByRole("button", { name: "Descargar" }));
    await waitFor(() => expect(requests).toEqual(["qwen3:1.7b"]));
  });

  it.each([
    ["LOCAL_OLLAMA_MISSING", false],
    ["LOCAL_OLLAMA_OFFLINE", true]
  ] as const)("keeps cloud progression available without requesting an optional fallback when local service is %s", async (state, binaryFound) => {
    useFixtures({ readiness: cpuReadiness([]) });
    const requests: string[] = [];
    server.use(http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
      requests.push(((await request.json()) as { tag: string }).tag);
      return HttpResponse.json({});
    }));
    const { queryClient } = renderFlow();
    await goToCloudKey();
    validateCloudKey({ ...cpuReadiness([]), state: "CLOUD_READY", provider: "cloud", can_chat: true });
    await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.");
    next();
    await screen.findByRole("heading", { name: "Un respaldo en tu PC" });
    fireEvent.click(screen.getByRole("switch"));
    // Ollama goes away while the user is still on the fallback screen.
    server.use(http.get(`${API_BASE_URL}/api/llm/readiness`, () => HttpResponse.json(unavailable("CLOUD_READY", binaryFound))));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["llmReadiness"] });
    });
    await waitFor(() => expect(screen.getByRole("switch")).toBeDisabled());
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    next();

    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    expect(requests).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(/Ollama/i);
  });

  it.each([
    ["ollama_unreachable", 503, /Ollama/i],
    ["invalid_tag", 422, /nombre del modelo no es válido/i]
  ] as const)("surfaces optional fallback failure %s after cloud progression without blocking the setup", async (detail, status, expected) => {
    useFixtures({ readiness: cpuReadiness([]) });
    const requests: string[] = [];
    server.use(http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
      requests.push(((await request.json()) as { tag: string }).tag);
      return HttpResponse.json({ detail }, { status });
    }));
    renderFlow();
    await goToCloudKey();
    validateCloudKey(unavailable("CLOUD_READY"));
    await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.");
    next();
    await screen.findByRole("heading", { name: "Un respaldo en tu PC" });
    fireEvent.click(screen.getByRole("switch"));

    next();

    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(requests).toEqual(["qwen3:1.7b"]);
  });
});

describe("SetupFlow — engine step without Ollama", () => {
  function noOllama(state: string, binaryFound?: boolean): LlmReadinessResponse {
    return {
      ...cpuReadiness([]), state, can_chat: false,
      ollama: { reachable: false, installed_models: [], ...(binaryFound === undefined ? {} : { binary_found: binaryFound }) }
    };
  }

  it("explains Ollama, offers the download right there and recommends the API key when Ollama is missing", async () => {
    useFixtures({ readiness: noOllama("LOCAL_OLLAMA_MISSING", false) });
    renderFlow();
    await goToEngine();
    expect(screen.getByText(/Ollama es un programa gratuito que corre modelos de IA en tu propio PC/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Descargar Ollama/ });
    expect(link).toHaveAttribute("href", "https://ollama.com/download");
    expect(screen.getByRole("button", { name: "Volver a detectar" })).toBeInTheDocument();
    expect(screen.getByText(/¿No quieres instalar nada\? Usa una API key/)).toBeInTheDocument();
    const cloud = screen.getByRole("button", { name: /En la nube con tu API key/ });
    expect(cloud).toHaveTextContent("Recomendado");
    expect(cloud).toBeEnabled();
    for (const name of [/En tu PC con tarjeta gráfica/, /En tu PC sin tarjeta gráfica/]) {
      const card = screen.getByRole("button", { name });
      expect(card).toBeDisabled();
      expect(card).not.toHaveTextContent("Recomendado");
    }
  });

  it("tells the user to open Ollama (no download link) when it is installed but not running", async () => {
    useFixtures({ readiness: noOllama("LOCAL_OLLAMA_OFFLINE", true) });
    renderFlow();
    await goToEngine();
    expect(screen.getByText(/Ábrelo y toca Volver a detectar/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Descargar Ollama/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver a detectar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /En la nube con tu API key/ })).toHaveTextContent("Recomendado");
    expect(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ })).toBeDisabled();
  });

  it("re-reads readiness when the user presses the recheck action", async () => {
    let calls = 0;
    useFixtures({ readiness: noOllama("LOCAL_OLLAMA_MISSING", false) });
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () => {
        calls += 1;
        return HttpResponse.json(calls > 1 ? cpuReadiness(["qwen3:1.7b"]) : noOllama("LOCAL_OLLAMA_MISSING", false));
      })
    );
    renderFlow();
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: "Volver a detectar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ })).toBeEnabled());
    expect(screen.queryByRole("link", { name: /Descargar Ollama/ })).not.toBeInTheDocument();
  });

  it("does not recommend the API key or explain Ollama when Ollama is ready", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    await goToEngine();
    expect(screen.getByRole("button", { name: /En la nube con tu API key/ })).not.toHaveTextContent("Recomendado");
    expect(screen.queryByText(/Ollama es un programa gratuito/)).not.toBeInTheDocument();
  });
});

describe("SetupFlow — model step Ollama explanation", () => {
  it("repeats the short what-is-Ollama line where the model step mentions Ollama", async () => {
    useFixtures({ readiness: { ...cpuReadiness([]), state: "LOCAL_OLLAMA_OFFLINE", ollama: { reachable: false, installed_models: [], binary_found: true } } });
    const { queryClient } = renderFlow();
    await goToEngine();
    act(() => queryClient.setQueryData(["llmReadiness"], cpuReadiness([])));
    fireEvent.click(await screen.findByRole("button", { name: /En tu PC sin tarjeta gráfica/ }));
    next();
    await screen.findByRole("heading", { name: "Elige un modelo" });
    act(() => queryClient.setQueryData(["llmReadiness"], { ...cpuReadiness([]), state: "LOCAL_OLLAMA_MISSING", ollama: { reachable: false, installed_models: [], binary_found: false } }));
    expect(await screen.findByText(/Ollama es un programa gratuito/)).toBeInTheDocument();
  });
});

describe("SetupFlow — modal shell", () => {
  it("opens as a labelled modal dialog on the language step with Kira's fixed line", () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Asistente de configuración" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("Paso 1 de 9")).toBeInTheDocument();
    expect(within(dialog).getByText(/Hola, soy Kira\. Primero dime/)).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Idioma · Language" })).toBeInTheDocument();
  });

  it("closes on Escape and on the close button", () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    const { onClose } = renderFlow();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar asistente" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("moves focus into the dialog and onto each new step heading", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await start();
    const heading = await screen.findByRole("heading", { name: "Tu PC" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("panel variant is not a dialog and leaves Escape to its host", () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    const { onClose } = renderFlow({ variant: "panel" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar asistente" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("SetupFlow — local CPU path end to end", () => {
  it("disables the GPU engine without a GPU, activates the installed model, tests voice and speed, then completes", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    const said = captureSpeech();
    const commands: unknown[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        commands.push(await request.json());
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 });
      }),
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, current_model: "qwen3:1.7b" })),
      http.post(`${API_BASE_URL}/api/setup/inference-test`, () =>
        HttpResponse.json({
          status: "slow",
          provider: "local",
          model: "qwen3:1.7b",
          metrics: { load_ms: null, first_token_ms: 2900, tokens_per_second: 7.25 },
          runs: [],
          error_code: null
        })
      )
    );
    const { onComplete } = renderFlow();

    await start("No se oye");
    expect(said).toContain("Hola, soy Kira. Si me escuchas, la voz funciona.");
    await screen.findByRole("heading", { name: "Tu PC" });
    await screen.findByText("No detectada. Se usará el procesador.");
    next();
    await screen.findByRole("heading", { name: "¿Cómo quieres que piense Kira?" });
    expect(screen.getByRole("button", { name: /En tu PC con tarjeta gráfica/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ }));
    expect(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ })).toHaveAttribute("aria-pressed", "true");
    next();

    // Model step: CPU shows light models only, recommended qwen3:1.7b preselected and installed.
    await screen.findByRole("heading", { name: "Elige un modelo" });
    const list = await screen.findByRole("group", { name: "Instalados" });
    expect(within(list).getByRole("button", { name: /Qwen 3 \(1\.7B\)/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(list).queryByRole("button", { name: /Gemma 4/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled());
    next();

    // Test step: nulls render as an em dash, the verdict is announced.
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    expect(commands).toContainEqual({ command: "switch_model", payload: { value: "qwen3:1.7b" } });
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));
    const verdict = await screen.findByText(/Funciona, pero lento/);
    expect(verdict.closest("[aria-live]")).not.toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("2.9 s")).toBeInTheDocument();
    expect(screen.getByText("Velocidad de respuesta")).toBeInTheDocument();
    expect(screen.getByText("7.3")).toBeInTheDocument();
    next();

    // Optional personalization: skipped here.
    await skipPersonalize();

    // Done step: summary plus the old welcome content.
    await screen.findByRole("heading", { name: "Todo listo" });
    const summary = screen.getByRole("list", { name: "Resumen de la configuración" });
    expect(within(summary).getByText("En tu PC sin tarjeta gráfica (más lento)")).toBeInTheDocument();
    expect(within(summary).getByText("Sin probar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lo que Kira puede hacer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Entrar a OpenCohost" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("downloads a missing model through the existing downloads API before allowing Continue", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    let downloads: ModelDownloadsResponse = { jobs: [], active_job_id: null, max_retries: 3 };
    const started: string[] = [];
    server.use(
      http.get(`${API_BASE_URL}/api/models/downloads`, () => HttpResponse.json(downloads)),
      http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
        const { tag } = (await request.json()) as { tag: string };
        started.push(tag);
        const job = {
          id: "job-1", tag, state: "completed", phase: "success", total_bytes: 100, completed_bytes: 100, percent: 100,
          speed_bps: null, eta_seconds: null, attempt: 1, retries_used: 0, error_category: null, error_type: null,
          interrupted: false, installed: true, created_at: 1, updated_at: 2
        } as const;
        downloads = { jobs: [job], active_job_id: null, max_retries: 3 };
        return HttpResponse.json(job, { status: 202 });
      })
    );
    renderFlow();
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ }));
    next();
    await screen.findByText("Qwen 3 (1.7B) no está instalado.");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Descargar" }));
    await waitFor(() => expect(started).toEqual(["qwen3:1.7b"]));
    await screen.findByText("Qwen 3 (1.7B) está listo.");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });
});

describe("SetupFlow — API key path", () => {
  async function goToKey() {
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En la nube con tu API key/ }));
    next();
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });
  }

  it("saves the key, validates it against the provider and clears the input", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    let putBody: Record<string, unknown> | null = null;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        putBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ active_provider: "openai", fallback_mode: "auto", pregen_enabled: false, profiles: {} });
      })
    );
    renderFlow();
    await goToKey();
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_READY", provider: "cloud", can_chat: true })
      )
    );
    const keyInput = screen.getByLabelText("API key");
    expect(keyInput).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.change(keyInput, { target: { value: "sk-test-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));

    expect(await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.")).toBeInTheDocument();
    expect(putBody).toMatchObject({ active_provider: "openai", profile_id: "openai", preset: "openai", model: "gpt-4o-mini", api_key: "sk-test-123" });
    expect(keyInput).toHaveValue("");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("reports a rejected key and keeps Continue disabled", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    renderFlow();
    await goToKey();
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_INVALID_CREDENTIALS", provider: "cloud", can_chat: false })
      )
    );
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));
    expect(await screen.findByText(/El proveedor no aceptó la API key/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  function validateCloudKey(readiness: LlmReadinessResponse) {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () => HttpResponse.json(readiness)),
      http.put(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(noProfiles))
    );
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));
  }

  it("tells the user the check spends a little balance and asks the model one tiny question", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    const testBodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/llm/provider/test`, async ({ request }) => {
        testBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ok: true, error_code: null, chat_ok: true, http_status: 200, models: [], recommended: [] });
      })
    );
    renderFlow();
    await goToKey();
    expect(
      screen.getByText("Haremos una pregunta cortita al modelo para comprobar que responde (gasta muy poquito de tu saldo).")
    ).toBeInTheDocument();
    validateCloudKey({ ...cpuReadiness([]), state: "CLOUD_READY", provider: "cloud", can_chat: true });
    await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.");
    expect(testBodies).toEqual([{ profile_id: "openai", preset: "openai", model: "gpt-4o-mini", check_chat: true }]);
    expect(screen.queryByRole("button", { name: "Seguir de todos modos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("blocks Continue when the model does not answer, shows the reason, and lets the user continue anyway", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    server.use(
      http.post(`${API_BASE_URL}/api/llm/provider/test`, () =>
        HttpResponse.json({
          ok: true,
          error_code: null,
          chat_ok: false,
          chat_error_code: "cloud_rate_limit",
          http_status: 402,
          provider_message: "Insufficient balance",
          models: [],
          recommended: []
        })
      )
    );
    renderFlow();
    await goToKey();
    expect(screen.queryByRole("button", { name: "Seguir de todos modos" })).not.toBeInTheDocument();
    validateCloudKey({ ...cpuReadiness([]), state: "CLOUD_READY", provider: "cloud", can_chat: true });
    expect(
      await screen.findByText("La key es válida, pero no hay saldo o llegaste al límite del proveedor.")
    ).toBeInTheDocument();
    expect(screen.getByText("HTTP 402: Insufficient balance")).toBeInTheDocument();
    expect(screen.queryByText("¡Listo! Tu API key funciona y el modelo responde.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Seguir de todos modos" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled());
  });

  it("offers to continue anyway after a rejected key too", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    renderFlow();
    await goToKey();
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_INVALID_CREDENTIALS", provider: "cloud", can_chat: false })
      )
    );
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));
    await screen.findByText(/El proveedor no aceptó la API key/);
    fireEvent.click(screen.getByRole("button", { name: "Seguir de todos modos" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled());
  });

  it("renders the local fallback as a labelled switch on its own screen after the key is valid", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    renderFlow();
    await goToKey();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_READY", provider: "cloud", can_chat: true })
      )
    );
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));
    await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.");
    next();
    await screen.findByRole("heading", { name: "Un respaldo en tu PC" });
    const fallback = screen.getByRole("switch", {
      name: "Guardar también un modelo pequeño en tu PC por si falla la nube (1.4 GB, se descarga al continuar)."
    });
    expect(fallback).toHaveAttribute("aria-checked", "false");
    fireEvent.click(fallback);
    expect(fallback).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("omits the local fallback step after API key when Ollama is missing, and Back returns directly to API key", async () => {
    useFixtures({
      readiness: {
        ...cpuReadiness([]),
        state: "LOCAL_OLLAMA_MISSING",
        can_chat: false,
        ollama: { reachable: false, installed_models: [], binary_found: false }
      }
    });
    renderFlow();
    await goToKey();
    validateCloudKey({
      ...cpuReadiness([]),
      state: "CLOUD_READY",
      provider: "cloud",
      can_chat: true,
      ollama: { reachable: false, installed_models: [], binary_found: false }
    });
    await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.");
    next();
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    expect(screen.queryByRole("heading", { name: "Un respaldo en tu PC" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });
  });

  it("keeps the local fallback step on the cloud path when Ollama is installed but offline", async () => {
    useFixtures({
      readiness: {
        ...cpuReadiness([]),
        state: "LOCAL_OLLAMA_OFFLINE",
        can_chat: false,
        ollama: { reachable: false, installed_models: [], binary_found: true }
      }
    });
    renderFlow();
    await goToKey();
    validateCloudKey({
      ...cpuReadiness([]),
      state: "CLOUD_READY",
      provider: "cloud",
      can_chat: true,
      ollama: { reachable: false, installed_models: [], binary_found: true }
    });
    await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.");
    next();
    await screen.findByRole("heading", { name: "Un respaldo en tu PC" });
  });
});

describe("SetupFlow — existing cloud profiles", () => {
  const profiles = {
    ...noProfiles,
    profiles: {
      nvidia_nim: { base_url: "https://integrate.api.nvidia.com/v1", model: "moonshotai/kimi-k3", preset: "nvidia_nim", api_key_set: true },
      openai: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", preset: "openai", api_key_set: false }
    }
  };

  function captureProviderPuts(): Array<Record<string, unknown>> {
    const puts: Array<Record<string, unknown>> = [];
    server.use(
      http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(profiles)),
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        puts.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(profiles);
      })
    );
    return puts;
  }

  async function goToProfiles() {
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En la nube con tu API key/ }));
    next();
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });
    return screen.findByRole("group", { name: "Tus proveedores" });
  }

  function cloudReady() {
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_READY", provider: "cloud", can_chat: true })
      )
    );
  }

  it("lists the saved profiles first and never shows a stored key", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    captureProviderPuts();
    renderFlow();
    const list = await goToProfiles();
    expect(within(list).getByText("nvidia_nim")).toBeInTheDocument();
    expect(within(list).getByText(/moonshotai\/kimi-k3/)).toBeInTheDocument();
    expect(within(list).getByText(/API key guardada/)).toBeInTheDocument();
    expect(within(list).getByText(/sin API key/)).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo proveedor" })).toBeInTheDocument();
  });

  it("activates a saved profile without sending any key, then validates it", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    const puts = captureProviderPuts();
    renderFlow();
    await goToProfiles();
    cloudReady();
    fireEvent.click(screen.getByRole("button", { name: "Usar nvidia_nim" }));
    expect(await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.")).toBeInTheDocument();
    expect(puts).toEqual([{ active_provider: "nvidia_nim" }]);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("edits a profile, keeping the stored key when the key field stays empty", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    const puts = captureProviderPuts();
    renderFlow();
    await goToProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Editar nvidia_nim" }));
    expect(screen.getByLabelText("URL base")).toHaveValue("https://integrate.api.nvidia.com/v1");
    expect(screen.getByLabelText("Modelo")).toHaveValue("moonshotai/kimi-k3");
    expect(screen.getByLabelText("API key")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "z-ai/glm-5.3-flash" } });
    cloudReady();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y validar" }));
    expect(await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.")).toBeInTheDocument();
    expect(puts).toEqual([
      {
        active_provider: "nvidia_nim",
        profile_id: "nvidia_nim",
        base_url: "https://integrate.api.nvidia.com/v1",
        model: "z-ai/glm-5.3-flash"
      }
    ]);
  });

  it("rotates the key of a profile and clears the field after saving", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    const puts = captureProviderPuts();
    renderFlow();
    await goToProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Editar nvidia_nim" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "nvapi-new" } });
    cloudReady();
    fireEvent.click(screen.getByRole("button", { name: "Guardar y validar" }));
    expect(await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.")).toBeInTheDocument();
    expect(puts[0]).toMatchObject({ profile_id: "nvidia_nim", api_key: "nvapi-new" });
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });

  it("asks for a key before using a profile that has none", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    const puts = captureProviderPuts();
    renderFlow();
    await goToProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Usar openai" }));
    expect(await screen.findByText(/no tiene API key guardada/)).toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(puts).toEqual([]);
    expect(screen.getByRole("button", { name: "Guardar y validar" })).toBeDisabled();
  });

  it("creates a new provider under a free id instead of overwriting a saved one", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    const puts = captureProviderPuts();
    renderFlow();
    await goToProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo proveedor" }));
    fireEvent.click(screen.getByRole("button", { name: "NVIDIA NIM" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "nvapi-2" } });
    cloudReady();
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));
    expect(await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.")).toBeInTheDocument();
    expect(puts[0]).toMatchObject({ active_provider: "nvidia_nim_2", profile_id: "nvidia_nim_2", preset: "nvidia_nim", api_key: "nvapi-2" });
  });
});

describe("SetupFlow — local GPU model groups", () => {
  const GEMMA = "hf.co/unsloth/gemma-4-E4B-it-GGUF:IQ4_NL";
  const QWEN = "hf.co/unsloth/Qwen3.5-4B-GGUF:Q4_K_M";
  const gpuCatalog = {
    "qwen3:1.7b": { display: "Qwen 3 (1.7B) ⚡", desc: "Muy pequeño.", size_gb: 1.4, family: "qwen3", min_vram_gb: 0 },
    [QWEN]: { display: "Qwen 3.5 (4B) ★", desc: "Para 6 GB.", size_gb: 3.4, family: "qwen3", min_vram_gb: 5 },
    [GEMMA]: { display: "Gemma 4 (E4B) IQ4_NL ★", desc: "Para 8 GB.", size_gb: 5.1, family: "gemma", min_vram_gb: 7.5 },
    "gemma4:31b": { display: "Gemma 4 (31B)", desc: "Enorme.", size_gb: 20, family: "gemma", min_vram_gb: 24 }
  };

  function gpuReadiness(installed: string[]): LlmReadinessResponse {
    return {
      ...defaultReadiness,
      ollama: { ...defaultReadiness.ollama, reachable: true, installed_models: installed },
      hardware: {
        ...defaultReadiness.hardware,
        gpu_name: "NVIDIA GeForce RTX 3060",
        total_vram_mb: 12288,
        cpu_only: false,
        recommended_tag: GEMMA
      } as LlmReadinessResponse["hardware"]
    };
  }

  function gpuFixtures(installed: string[]) {
    useFixtures({ readiness: gpuReadiness(installed), models: { catalog: gpuCatalog, discovered: installed } });
  }

  /** The engine applies a switch only after `applyAfter` status reads (accepted != applied). */
  function engineWithSlowSwitch(initial: string, applyAfter = 2) {
    const commands: Array<{ command: string; payload: { value?: string } }> = [];
    let current = initial;
    let readsSinceSwitch = 0;
    let target: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        const body = (await request.json()) as { command: string; payload: { value?: string } };
        commands.push(body);
        if (body.command === "switch_model") {
          target = body.payload.value ?? null;
          readsSinceSwitch = 0;
        }
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 });
      }),
      http.get(`${API_BASE_URL}/api/status`, () => {
        if (target) {
          readsSinceSwitch += 1;
          if (readsSinceSwitch > applyAfter) current = target;
        }
        return HttpResponse.json({ ...defaultStatus, current_model: current });
      })
    );
    return commands;
  }

  async function goToGpuModels() {
    await start();
    await screen.findByRole("heading", { name: "Tu PC" });
    await screen.findAllByText(/RTX 3060/);
    next();
    await screen.findByRole("heading", { name: "¿Cómo quieres que piense Kira?" });
    fireEvent.click(screen.getByRole("button", { name: /En tu PC con tarjeta gráfica/ }));
    next();
    await screen.findByRole("heading", { name: "Elige un modelo" });
  }

  it("lists every installed model under Instalados and only fitting, missing catalog models under Para descargar", async () => {
    gpuFixtures([QWEN, GEMMA, "mistral:7b"]);
    renderFlow();
    await goToGpuModels();
    const installed = await screen.findByRole("group", { name: "Instalados" });
    const gemma = within(installed).getByRole("button", { name: /Gemma 4 \(E4B\) IQ4_NL/ });
    expect(gemma).toHaveAttribute("aria-pressed", "true");
    expect(within(gemma).getByText("Recomendado")).toBeInTheDocument();
    expect(within(installed).getByRole("button", { name: /Qwen 3\.5 \(4B\)/ })).toBeInTheDocument();
    expect(within(installed).getByRole("button", { name: /mistral:7b/ })).toBeInTheDocument();
    expect(screen.queryByText("Instalado")).not.toBeInTheDocument();

    const downloads = screen.getByRole("group", { name: "Para descargar" });
    expect(within(downloads).getByRole("button", { name: /Qwen 3 \(1\.7B\)/ })).toBeInTheDocument();
    expect(within(downloads).queryByRole("button", { name: /Gemma 4 \(31B\)/ })).not.toBeInTheDocument();
    expect(within(downloads).queryByRole("button", { name: /Qwen 3\.5/ })).not.toBeInTheDocument();
  });

  it("hides the download group when every fitting catalog model is installed", async () => {
    gpuFixtures(["qwen3:1.7b", QWEN, GEMMA]);
    renderFlow();
    await goToGpuModels();
    await screen.findByRole("group", { name: "Instalados" });
    expect(screen.queryByRole("group", { name: "Para descargar" })).not.toBeInTheDocument();
  });

  it("does not leave the model step until the engine reports the chosen model active", async () => {
    gpuFixtures([QWEN, GEMMA]);
    const commands = engineWithSlowSwitch(QWEN);
    renderFlow();
    await goToGpuModels();
    await screen.findByText("Gemma 4 (E4B) IQ4_NL ★ está listo.");
    next();
    // Accepted is not applied: the button reports the activation and the step stays put.
    expect(await screen.findByRole("button", { name: /Activando el modelo/ })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Elige un modelo" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Prueba de velocidad" }, { timeout: 4000 });
    expect(commands).toEqual([{ command: "switch_model", payload: { value: GEMMA } }]);
  });

  it("stays on the model step with an error when the engine reports the switch failed", async () => {
    gpuFixtures([QWEN, GEMMA]);
    engineWithSlowSwitch(QWEN, Number.POSITIVE_INFINITY);
    renderFlow();
    await goToGpuModels();
    await screen.findByText("Gemma 4 (E4B) IQ4_NL ★ está listo.");
    next();
    await screen.findByRole("button", { name: /Activando el modelo/ });
    act(() => {
      useEventStore.getState().append({ id: "fail-1", ts: Date.now(), source: "motor", action: "model_switch_failed", label: "x", tone: "danger" });
    });
    expect(await screen.findByText(/No pude activar el modelo/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Elige un modelo" })).toBeInTheDocument();
  });

  it("warns when the speed test measured a different model than the one chosen", async () => {
    gpuFixtures([QWEN, GEMMA]);
    engineWithSlowSwitch(GEMMA, 0);
    server.use(
      http.post(`${API_BASE_URL}/api/setup/inference-test`, () =>
        HttpResponse.json({
          status: "passed",
          provider: "local",
          model: QWEN,
          metrics: { load_ms: 300, first_token_ms: 400, tokens_per_second: 69.3 },
          runs: [],
          error_code: null
        })
      )
    );
    renderFlow();
    await goToGpuModels();
    await screen.findByText("Gemma 4 (E4B) IQ4_NL ★ está listo.");
    next();
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));
    expect(await screen.findByText(`La prueba corrió con ${QWEN}, no con Gemma 4 (E4B) IQ4_NL ★. Vuelve al paso Modelo para activarlo.`)).toBeInTheDocument();
  });

  it("shows a plain rate-limit message plus the HTTP status and provider detail on a cloud failure", async () => {
    gpuFixtures([QWEN, GEMMA]);
    engineWithSlowSwitch(GEMMA, 0);
    server.use(
      http.post(`${API_BASE_URL}/api/setup/inference-test`, () =>
        HttpResponse.json({
          status: "failed",
          provider: "cloud",
          model: "gemini-3.5-flash-lite",
          metrics: { load_ms: null, first_token_ms: null, tokens_per_second: null },
          runs: [],
          error_code: "cloud_rate_limit",
          http_status: 429,
          provider_message: "You exceeded your current quota [RESOURCE_EXHAUSTED]"
        })
      )
    );
    renderFlow();
    await goToGpuModels();
    await screen.findByText("Gemma 4 (E4B) IQ4_NL ★ está listo.");
    next();
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));
    expect(await screen.findByText(/Sin créditos o llegaste al límite/)).toBeInTheDocument();
    expect(screen.getByText("HTTP 429: You exceeded your current quota [RESOURCE_EXHAUSTED]")).toBeInTheDocument();
  });

  it("speaks the speed test verdict, reads the summary on done, and returns to done after a Cambiar edit", async () => {
    gpuFixtures([QWEN, GEMMA]);
    engineWithSlowSwitch(GEMMA, 0);
    const said = captureSpeech();
    server.use(
      http.post(`${API_BASE_URL}/api/setup/inference-test`, () =>
        HttpResponse.json({
          status: "passed",
          provider: "local",
          model: GEMMA,
          metrics: { load_ms: 300, first_token_ms: 412, tokens_per_second: 69.3 },
          runs: [],
          error_code: null
        })
      )
    );
    renderFlow();
    await goToGpuModels();
    await screen.findByText("Gemma 4 (E4B) IQ4_NL ★ está listo.");
    next();
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));

    const verdict = "Listo: empiezo a hablar en 0.4 segundos y respondo con buena velocidad. Bien para directo.";
    await waitFor(() => expect(said).toContain(verdict));
    expect(within(screen.getByRole("complementary", { name: "Kira" })).getByText(verdict).closest("[aria-live]")).not.toBeNull();
    next();
    await skipPersonalize();

    await screen.findByRole("heading", { name: "Todo listo" });
    const summaryLine = "Listo. Así quedé: En tu PC con tarjeta gráfica, con Gemma 4 (E4B) IQ4_NL ★, y con voz. Si quieres cambiar algo, toca Cambiar.";
    await waitFor(() => expect(said).toContain(summaryLine));

    // Cambiar on the voice row: answer again, and Continue lands straight back on done.
    fireEvent.click(screen.getByRole("button", { name: "Cambiar Voz" }));
    await toVoiceTest("No se oye");
    next();
    await screen.findByRole("heading", { name: "Todo listo" });
    expect(within(screen.getByRole("list", { name: "Resumen de la configuración" })).getByText("Sin probar")).toBeInTheDocument();
  });

  it("does not speak the verdict while muted", async () => {
    gpuFixtures([QWEN, GEMMA]);
    engineWithSlowSwitch(GEMMA, 0);
    const said = captureSpeech();
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "Silenciar voz" }));
    await goToGpuModels();
    await screen.findByText("Gemma 4 (E4B) IQ4_NL ★ está listo.");
    next();
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));
    await screen.findByText(/Bien para directo/, { selector: "aside p" });
    expect(said.filter((text) => text.startsWith("Listo:"))).toEqual([]);
  });
});

describe("SetupFlow — narration voice", () => {
  it("stays silent until the user answers, then speaks each step's line and stops when muted", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    const said = captureSpeech();
    renderFlow();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(said).toEqual([]);

    // The language screens have no hear-Kira question, so she stays quiet there and on the narrator screen until answered.
    next();
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(said).toEqual([]);

    next();
    await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(said).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Sí, quiero escucharla" }));
    await waitFor(() => expect(said[0]).toMatch(/Ahora tú decides/));

    fireEvent.click(screen.getByRole("button", { name: "Silenciar voz" }));
    expect(screen.getByRole("button", { name: "Silenciar voz" })).toHaveAttribute("aria-pressed", "true");
    next();
    await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
    next();
    await screen.findByRole("heading", { name: "¿Qué tan rápido habla?" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(said).toHaveLength(1);
  });
});

describe("SetupFlow — narrator mute persistence", () => {
  it("stores the mute choice and restores it on the next run", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "Silenciar voz" }));
    expect(window.localStorage.getItem(NARRATOR_MUTED_KEY)).toBe("1");
    cleanup();
    renderFlow();
    expect(screen.getByRole("button", { name: "Silenciar voz" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("SetupFlow — start screens", () => {
  it("asks UI language first without restart, then Kira's speech language, then hear-Kira", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    expect(screen.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(useUiLocaleStore.getState().locale).toBe("en");
    expect(window.localStorage.getItem("oc-ui-locale")).toBe("en");
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    // One decision per screen: neither Kira's language nor the hear-Kira question is on this screen.
    expect(screen.queryByRole("button", { name: /Restart to apply/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Do you want to hear Kira while she guides you?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    next("Continue");
    await screen.findByRole("heading", { name: "Which language will Kira speak?" });
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    next("Continue");
    expect(await screen.findByText("Do you want to hear Kira while she guides you?")).toBeInTheDocument();
  });

  it("wires the hear-Kira question to the narrator mute state", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    expect(screen.queryByText("¿Quieres escuchar a Kira mientras te guía?")).not.toBeInTheDocument();
    next();
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    next();
    expect(await screen.findByText("¿Quieres escuchar a Kira mientras te guía?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No, solo texto" }));
    expect(screen.getByRole("button", { name: "Silenciar voz" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Sí, quiero escucharla" }));
    expect(screen.getByRole("button", { name: "Silenciar voz" })).toHaveAttribute("aria-pressed", "false");
  });

  it("summarises what will be set up and says it is a one-time, re-openable flow", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    next();
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    next();
    fireEvent.click(await screen.findByRole("button", { name: "No, solo texto" }));
    next();
    await toVoiceTest("No se oye");
    next();
    await screen.findByRole("heading", { name: "Vamos a dejar a Kira lista" });
    const list = screen.getByRole("list", { name: "Lo que vamos a hacer" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).queryByText(/Su voz/)).not.toBeInTheDocument();
    expect(screen.getByText("Esto se hace una sola vez. Puedes volver cuando quieras escribiendo /setup.")).toBeInTheDocument();
  });
});

describe("SetupFlow — personalize block", () => {
  async function reachPersonalize() {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "c", status: "queued", state_version: 2 })
      ),
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, current_model: "qwen3:1.7b" })),
      http.post(`${API_BASE_URL}/api/speech/say`, () => HttpResponse.json({ job_id: 1 })),
      http.post(`${API_BASE_URL}/api/setup/inference-test`, () =>
        HttpResponse.json({
          status: "passed", provider: "local", model: "qwen3:1.7b",
          metrics: { load_ms: 300, first_token_ms: 400, tokens_per_second: 50 }, runs: [], error_code: null
        })
      )
    );
    renderFlow();
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ }));
    next();
    await screen.findByRole("heading", { name: "Elige un modelo" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled());
    next();
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));
    await screen.findByText(/Bien para directo/, { selector: "aside p" });
    next();
    await screen.findByRole("heading", { name: "¿Quieres personalizar a Kira ahora?" });
  }

  it("asks after the speed test and goes straight to done on 'Ahora no'", async () => {
    await reachPersonalize();
    expect(screen.getByText("Puedes hacerlo luego en Controles o escribiendo /setup.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    await screen.findByRole("heading", { name: "Todo listo" });
    const summary = screen.getByRole("list", { name: "Resumen de la configuración" });
    expect(within(summary).getByText("Para después")).toBeInTheDocument();
  });

  it("opens the avatar screen on 'Sí' and a skip leads to done", async () => {
    await reachPersonalize();
    fireEvent.click(screen.getByRole("button", { name: "Sí, personalizar" }));
    for (const [heading, skip] of [
      ["Elige cómo se ve Kira", "Continuar"],
      ["Tú y tu perfil", "Saltar"],
      ["Búsqueda en internet", "Saltar"],
      ["Hablar con tu voz", "Continuar"],
      ["Tema de la app", "Continuar"]
    ]) {
      await screen.findByRole("heading", { name: heading });
      fireEvent.click(screen.getByRole("button", { name: skip }));
    }
    await screen.findByRole("heading", { name: "Todo listo" });
    expect(within(screen.getByRole("list", { name: "Resumen de la configuración" })).getByText("Ahora")).toBeInTheDocument();
  });
});

describe("SetupFlow — review fixes (S8)", () => {
  async function toHardware() {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    const flow = renderFlow();
    await start();
    await screen.findByRole("heading", { name: "Tu PC" });
    return flow;
  }

  it("needs a hear-Kira answer on its own screen only when none is stored", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
    next();
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    next();
    await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "No, solo texto" }));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
    cleanup();
    window.localStorage.setItem(NARRATOR_MUTED_KEY, "0");
    renderFlow();
    next();
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    next();
    await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
    expect(screen.getByRole("button", { name: "Sí, quiero escucharla" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("asks before closing once past the first two screens, and keeps going on 'Seguir configurando'", async () => {
    const { onClose } = await toHardware();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/¿Salir de la configuración\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Seguir configurando" }));
    expect(screen.queryByText(/¿Salir de la configuración\?/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar asistente" }));
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the stepper only as a counter inside the modal", async () => {
    await toHardware();
    expect(screen.queryByRole("list", { name: "Pasos de la configuración" })).not.toBeInTheDocument();
    expect(screen.getByText("Paso 4 de 9")).toBeInTheDocument();
  });

  it("keeps the step list in the /setup panel", () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow({ variant: "panel" });
    expect(screen.getByRole("list", { name: "Pasos de la configuración" })).toBeInTheDocument();
    expect(screen.getByText("Cerebro de Kira")).toBeInTheDocument();
  });

  it("re-opens a completed setup on the summary, prefilled from the current configuration", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    const { onClose, onComplete } = renderFlow({ resume: true });
    await screen.findByRole("heading", { name: "Todo listo" });
    const summary = screen.getByRole("list", { name: "Resumen de la configuración" });
    await waitFor(() => expect(within(summary).getByText("En tu PC sin tarjeta gráfica (más lento)")).toBeInTheDocument());
    expect(within(summary).getByText("Qwen 3 (1.7B)")).toBeInTheDocument();
    // Closing the summary counts as finishing, never as a skip.
    fireEvent.click(screen.getByRole("button", { name: "Cerrar asistente" }));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has no footer Continue on the profile and extras screens, so typed data is never silently dropped", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow({ resume: true });
    await screen.findByRole("heading", { name: "Todo listo" });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar Personalizar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sí, personalizar" }));
    await screen.findByRole("heading", { name: "Elige cómo se ve Kira" });
    expect(screen.getByText("Paso 8 de 9")).toBeInTheDocument();
    next();
    await screen.findByRole("heading", { name: "Tú y tu perfil" });
    expect(screen.getByText("Paso 8 de 9")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Saltar" })).toHaveLength(1);
  });
});

describe("SetupFlow — one decision per screen (S9)", () => {
  async function toVoiceKind() {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow();
    await screen.findByRole("heading", { name: "Idioma · Language" });
    next();
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    next();
    await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
    if (screen.getByRole("button", { name: "Continuar" }).hasAttribute("disabled")) {
      fireEvent.click(screen.getByRole("button", { name: "Sí, quiero escucharla" }));
    }
    next();
    await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
  }

  it("walks the voice block right after narrator as three screens under one counter step, and Back returns to the previous screen", async () => {
    await toVoiceKind();
    const counter = screen.getByText(/^Paso \d+ de 9$/).textContent;
    expect(counter).toBe("Paso 2 de 9");
    expect(screen.queryByRole("button", { name: "Lenta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reproducir voz de prueba" })).not.toBeInTheDocument();
    next();
    await screen.findByRole("heading", { name: "¿Qué tan rápido habla?" });
    expect(screen.getByText(counter!)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Voz en tu PC/ })).not.toBeInTheDocument();
    next();
    await screen.findByRole("heading", { name: "Prueba de voz" });
    expect(screen.getByText(counter!)).toBeInTheDocument();
    // The answer is the only decision here: no Continue until it is given.
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await screen.findByRole("heading", { name: "¿Qué tan rápido habla?" });
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
  });

  it("says 'No se oye' silences only Kira's guide in this setup, before and after answering", async () => {
    await toVoiceKind();
    next();
    await screen.findByRole("heading", { name: "¿Qué tan rápido habla?" });
    next();
    await screen.findByRole("heading", { name: "Prueba de voz" });
    fireEvent.click(screen.getByRole("button", { name: "Reproducir voz de prueba" }));
    await screen.findByText("¿Me escuchaste?");
    expect(screen.getByText(/solo apaga la guía de Kira durante esta configuración/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No se oye" }));
    expect(screen.getByText(/silencia solo la guía de Kira durante esta configuración/)).toBeInTheDocument();
  });

  it("keeps the cloud fallback on its own screen, under the same counter step as the API key", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    renderFlow();
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En la nube con tu API key/ }));
    next();
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });
    const counter = screen.getByText(/^Paso \d+ de 9$/).textContent;
    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_READY", provider: "cloud", can_chat: true })
      ),
      http.put(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(noProfiles))
    );
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));
    await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    next();
    await screen.findByRole("heading", { name: "Un respaldo en tu PC" });
    expect(screen.getByText(counter!)).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    // Skipping the optional backup needs no action: Continue goes on to the speed test.
    next();
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
  });

  it("re-opened summary: Cambiar on the voice row lands on the first voice screen and walks the three-screen block", async () => {
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    renderFlow({ resume: true });
    await screen.findByRole("heading", { name: "Todo listo" });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar Voz" }));
    await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
    next();
    await screen.findByRole("heading", { name: "¿Qué tan rápido habla?" });
    next();
    await screen.findByRole("heading", { name: "Prueba de voz" });
  });
});

describe("SetupFlow — fresh-start notice", () => {
  const NOTICE = /Conservamos tus perfiles, ajustes y claves; la memoria empieza de cero/;

  async function toWelcome(legacy_install: boolean) {
    server.use(http.get(`${API_BASE_URL}/api/setup/state`, () => HttpResponse.json({ ...defaultSetupState, legacy_install })));
    renderFlow();
    await screen.findByRole("heading", { name: "Idioma · Language" });
    next();
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    next();
    await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
    if (screen.getByRole("button", { name: "Continuar" }).hasAttribute("disabled")) {
      fireEvent.click(screen.getByRole("button", { name: "Sí, quiero escucharla" }));
    }
    next();
    await toVoiceTest();
    next();
    await screen.findByRole("heading", { name: "Vamos a dejar a Kira lista" });
  }

  it("shows one informational line on the welcome when a legacy install was detected", async () => {
    await toWelcome(true);
    expect(await screen.findByText(NOTICE)).toBeTruthy();
    expect(screen.getByText(/Detectamos una versión anterior de OpenCohost/)).toBeTruthy();
  });

  it("shows nothing extra without a legacy install", async () => {
    await toWelcome(false);
    await screen.findByText(/Esto se hace una sola vez/);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

describe("SetupFlow — S3 API key & model loading/error feedback", () => {
  const savedProfiles = {
    ...noProfiles,
    profiles: {
      nvidia_nim: { base_url: "https://integrate.api.nvidia.com/v1", model: "moonshotai/kimi-k3", preset: "nvidia_nim", api_key_set: true },
      openai: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", preset: "openai", api_key_set: true }
    }
  };

  async function goToSavedProfiles() {
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En la nube con tu API key/ }));
    next();
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });
    return screen.findByRole("group", { name: "Tus proveedores" });
  }

  it("shows 'Validando…' + spinner on the specific profile 'Usar' button and active phase copy in statusLine", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    let releaseReadiness!: () => void;
    let releaseTest!: () => void;
    const readinessGate = new Promise<void>((resolve) => { releaseReadiness = resolve; });
    const testGate = new Promise<void>((resolve) => { releaseTest = resolve; });
    server.use(
      http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(savedProfiles)),
      http.put(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(savedProfiles))
    );
    renderFlow();
    const list = await goToSavedProfiles();

    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, async () => {
        await readinessGate;
        return HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_READY", provider: "cloud", can_chat: true });
      }),
      http.post(`${API_BASE_URL}/api/llm/provider/test`, async () => {
        await testGate;
        return HttpResponse.json({ ok: true, error_code: null, chat_ok: true, http_status: 200, models: [], recommended: [] });
      })
    );

    fireEvent.click(within(list).getByRole("button", { name: "Usar nvidia_nim" }));

    const validatingBtn = await within(list).findByRole("button", { name: /Validando nvidia_nim/ });
    expect(validatingBtn).toBeDisabled();
    expect(validatingBtn).toHaveTextContent("Validando…");
    expect(validatingBtn.querySelector("svg.animate-spin")).not.toBeNull();
    expect(within(list).getByRole("button", { name: "Usar openai" })).toHaveTextContent("Usar");
    expect(await screen.findByText(/Autenticando API key con el proveedor/)).toBeInTheDocument();

    releaseReadiness();
    expect(await screen.findByText(/Esperando respuesta de prueba de moonshotai\/kimi-k3/)).toBeInTheDocument();

    releaseTest();
    expect(await screen.findByText("¡Listo! Tu API key funciona y el modelo responde.")).toBeInTheDocument();
  });

  it("surfaces real provider http_status and provider_message when readiness fails with CLOUD_INVALID_CREDENTIALS", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(noProfiles))
    );
    renderFlow();
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En la nube con tu API key/ }));
    next();
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });

    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_INVALID_CREDENTIALS", provider: "cloud", can_chat: false })
      ),
      http.post(`${API_BASE_URL}/api/llm/provider/test`, () =>
        HttpResponse.json({
          ok: false,
          error_code: "invalid_key",
          http_status: 401,
          provider_message: "Incorrect API key provided",
          models: [],
          recommended: []
        })
      )
    );

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));

    expect(await screen.findByText("La key no es válida. Revisa que la copiaste completa.")).toBeInTheDocument();
    expect(screen.getByText("HTTP 401: Incorrect API key provided")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seguir de todos modos" })).toBeInTheDocument();
  });

  it("surfaces HTTP error details when readiness is CLOUD_UNREACHABLE and provider test errors with 504", async () => {
    useFixtures({ readiness: cpuReadiness([]) });
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json(noProfiles))
    );
    renderFlow();
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En la nube con tu API key/ }));
    next();
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });

    server.use(
      http.get(`${API_BASE_URL}/api/llm/readiness`, () =>
        HttpResponse.json({ ...cpuReadiness([]), state: "CLOUD_UNREACHABLE", provider: "cloud", can_chat: false })
      ),
      http.post(`${API_BASE_URL}/api/llm/provider/test`, () =>
        HttpResponse.json({ detail: "Gateway Timeout" }, { status: 504 })
      )
    );

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-slow" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar API key" }));

    expect(await screen.findByText(/No se pudo conectar con el proveedor/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 504/)).toBeInTheDocument();
  });

  it("shows a spinner on the model Download button and on model activation while switching", async () => {
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>((resolve) => { releaseDownload = resolve; });
    useFixtures({ readiness: cpuReadiness([]) });
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
        await downloadGate;
        const { tag } = (await request.json()) as { tag: string };
        return HttpResponse.json({ id: "job-1", tag, state: "queued" }, { status: 202 });
      })
    );
    renderFlow();
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ }));
    next();
    await screen.findByText("Qwen 3 (1.7B) no está instalado.");

    const dlBtn = screen.getByRole("button", { name: "Descargar" });
    fireEvent.click(dlBtn);
    const startingBtn = await screen.findByRole("button", { name: "Iniciando descarga…" });
    expect(startingBtn).toBeDisabled();
    expect(startingBtn.querySelector("svg.animate-spin")).not.toBeNull();
    releaseDownload();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Iniciando descarga…" })).not.toBeInTheDocument());
  });

  it("shows spinner + activating status inside ModelStep and footer button while switching local model", async () => {
    let releaseStatus = false;
    useFixtures({ readiness: cpuReadiness(["qwen3:1.7b"]) });
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 })
      ),
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, current_model: releaseStatus ? "qwen3:1.7b" : "other:model" })
      )
    );
    renderFlow();
    await goToEngine();
    fireEvent.click(screen.getByRole("button", { name: /En tu PC sin tarjeta gráfica/ }));
    next();
    await screen.findByText("Qwen 3 (1.7B) está listo.");

    next();
    const activatingBtn = await screen.findByRole("button", { name: /Activando el modelo/ });
    expect(activatingBtn).toBeDisabled();
    expect(activatingBtn.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Activando Qwen 3 \(1\.7B\)/);

    releaseStatus = true;
    await screen.findByRole("heading", { name: "Prueba de velocidad" }, { timeout: 4000 });
  });
});
