import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultI18nState, defaultLlmProvider, defaultModels, defaultReadiness } from "../../test/handlers.js";
import { reloadBackend } from "../../lib/backendControl.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import type { LlmReadinessResponse } from "../../api/client.js";
import type { SetupCheckpoint } from "../../api/setup.js";
import { RESTART_HOOK } from "../shared/RestartToApply.js";
import { SetupFlow, type SetupFlowProps } from "./SetupFlow.js";

vi.mock("../../lib/backendControl.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/backendControl.js")>()),
  reloadBackend: vi.fn()
}));

const catalog = {
  "qwen3:1.7b": { display: "Qwen 3 (1.7B)", desc: "Muy pequeño.", size_gb: 1.4, family: "qwen3", min_vram_gb: 0 }
};

function cpuReadiness(installed: string[], reachable = true): LlmReadinessResponse {
  return {
    ...defaultReadiness,
    ...(reachable ? {} : { state: "LOCAL_OLLAMA_MISSING", can_chat: false }),
    ollama: { ...defaultReadiness.ollama, reachable, installed_models: installed, ...(reachable ? {} : { binary_found: false }) },
    hardware: {
      ...defaultReadiness.hardware,
      gpu_name: null,
      total_vram_mb: 0,
      cpu_only: true,
      recommended_tag: "qwen3:1.7b"
    } as LlmReadinessResponse["hardware"]
  };
}

function useFixtures(readiness: LlmReadinessResponse) {
  server.use(
    http.get(`${API_BASE_URL}/api/llm/readiness`, () => HttpResponse.json(readiness)),
    http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json({ ...defaultLlmProvider, active_provider: "local", profiles: {} })),
    http.get(`${API_BASE_URL}/api/models`, () =>
      HttpResponse.json({ ...defaultModels, catalog, discovered: readiness.ollama.installed_models, current_model: "qwen3:1.7b" })
    )
  );
}

/** Records every checkpoint write (PUT bodies, and "DELETE"). */
function captureCheckpoint(status = 200) {
  const writes: Array<Record<string, unknown> | "DELETE"> = [];
  server.use(
    http.put(`${API_BASE_URL}/api/setup/checkpoint`, async ({ request }) => {
      writes.push((await request.json()) as Record<string, unknown>);
      return status === 200 ? HttpResponse.json({ checkpoint: null }) : HttpResponse.json({ detail: "x" }, { status });
    }),
    http.delete(`${API_BASE_URL}/api/setup/checkpoint`, () => {
      writes.push("DELETE");
      return HttpResponse.json({ checkpoint: null });
    })
  );
  return writes;
}

function renderFlow(props: Partial<SetupFlowProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SetupFlow variant="modal" onClose={vi.fn()} onComplete={vi.fn()} {...props} />
    </QueryClientProvider>
  );
}

function cp(step: string, answers: Record<string, unknown>): SetupCheckpoint {
  return { version: 1, step, answers, updated_at: "2026-11-12T10:00:00+00:00" } as unknown as SetupCheckpoint;
}

const LOCAL = { engine: "cpu", model: "qwen3:1.7b", model_ready: true, hear_kira: false, language: "es" };

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  useUiLocaleStore.getState().setLocale("es");
  vi.mocked(reloadBackend).mockReset();
});

describe("SetupFlow — checkpoint saving (S10)", () => {
  it("saves a non-secret checkpoint when the user moves to the next screen", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    const writes = captureCheckpoint();
    renderFlow();
    await screen.findByRole("heading", { name: "Idioma · Language" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const kiraStepWrite = writes[writes.length - 1] as { version: number; step: string; answers: Record<string, unknown> };
    expect(kiraStepWrite.step).toBe("kiraLanguage");

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
    await waitFor(() => expect(writes.some((w) => typeof w === "object" && w.step === "narrator")).toBe(true));
    const last = writes[writes.length - 1] as { version: number; step: string; answers: Record<string, unknown> };
    expect(last.version).toBe(1);
    expect(last.step).toBe("narrator");
    expect(last.answers.language).toBe("es");
    expect(JSON.stringify(last)).not.toMatch(/api_key|tavily/i);
  });

  it("never saves on the first screen", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    const writes = captureCheckpoint();
    renderFlow();
    await screen.findByRole("heading", { name: "Idioma · Language" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(writes).toEqual([]);
  });

  it("a failed save never blocks the user and shows no error", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    captureCheckpoint(503);
    renderFlow();
    await screen.findByRole("heading", { name: "Idioma · Language" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "¿En qué idioma hablará Kira?" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "¿Escuchamos a Kira?" });
    fireEvent.click(screen.getByRole("button", { name: "Sí, quiero escucharla" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves the checkpoint at narrator before restarting on kiraLanguage and resumes past step 0", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    const writes = captureCheckpoint();
    const order: string[] = [];
    server.use(
      http.put(`${API_BASE_URL}/api/i18n`, async ({ request }) => {
        const { locale } = (await request.json()) as { locale: string };
        return HttpResponse.json({ ...defaultI18nState, persisted_locale: locale, pending_restart: locale !== "es" });
      }),
      http.put(`${API_BASE_URL}/api/setup/checkpoint`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        writes.push(body);
        order.push(`checkpoint:${String(body.step)}`);
        return HttpResponse.json({ checkpoint: null });
      })
    );
    vi.mocked(reloadBackend).mockImplementation(async () => {
      order.push("reload");
      return { ok: true };
    });
    const afterReload = vi.fn(() => order.push("afterReload"));
    RESTART_HOOK.afterReload = afterReload;

    renderFlow();
    await screen.findByRole("heading", { name: "Idioma · Language" });
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Which language will Kira speak?" });
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restart to apply" }));

    await waitFor(() => expect(afterReload).toHaveBeenCalledTimes(1));
    const narratorIdx = order.indexOf("checkpoint:narrator");
    const reloadIdx = order.indexOf("reload");
    expect(narratorIdx).toBeGreaterThanOrEqual(0);
    expect(narratorIdx).toBeLessThan(reloadIdx);

    const saved = writes[writes.length - 1] as { version: number; step: string; answers: Record<string, unknown> };
    expect(saved.step).toBe("narrator");
    expect(saved.answers.language).toBe("en");

    cleanup();
    useUiLocaleStore.getState().setLocale("es");
    renderFlow({ checkpoint: { ...saved, updated_at: "2026-11-16T00:00:00+00:00" } as unknown as SetupCheckpoint });
    const resume = await screen.findByRole("button", { name: "Continue where you left off (Language)" });
    await waitFor(() => expect(resume).toBeEnabled());
    fireEvent.click(resume);
    await screen.findByRole("heading", { name: "Shall we hear Kira?" });
    expect(screen.queryByRole("heading", { name: "Idioma · Language" })).not.toBeInTheDocument();
  });

  it("does not save while a completed setup is re-opened", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    const writes = captureCheckpoint();
    renderFlow({ resume: true });
    await screen.findByRole("heading", { name: "Todo listo" });
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar Voz" }));
    await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(writes).toEqual([]);
  });
});

const LOCAL_TEST = { ...LOCAL, voice: "ok" };

describe("SetupFlow — resume from a checkpoint (S10)", () => {
  it("offers one decision, then continues on the saved screen", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    captureCheckpoint();
    renderFlow({ checkpoint: cp("voice", LOCAL) });
    await screen.findByRole("heading", { name: "¿Seguimos donde quedamos?" });
    const resume = await screen.findByRole("button", { name: "Continuar donde lo dejaste (Voz)" });
    expect(screen.getByRole("button", { name: "Empezar de nuevo" })).toBeInTheDocument();
    // No footer Continue: the two choices are the only way forward.
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    await waitFor(() => expect(resume).toBeEnabled());
    fireEvent.click(resume);
    await screen.findByRole("heading", { name: "¿Qué voz prefieres?" });
  });

  it("drops back to the model screen with a reason when the model is gone", async () => {
    useFixtures(cpuReadiness(["llama3"]));
    captureCheckpoint();
    renderFlow({ checkpoint: cp("test", LOCAL_TEST) });
    const resume = await screen.findByRole("button", { name: /Continuar donde lo dejaste/ });
    await waitFor(() => expect(resume).toBeEnabled());
    fireEvent.click(resume);
    await screen.findByRole("heading", { name: "Elige un modelo" });
    expect(screen.getByText("El modelo que elegiste ya no está instalado. Elige uno.")).toBeInTheDocument();
  });

  it("drops back to the engine screen when Ollama is now missing", async () => {
    useFixtures(cpuReadiness([], false));
    captureCheckpoint();
    renderFlow({ checkpoint: cp("test", LOCAL_TEST) });
    const resume = await screen.findByRole("button", { name: /Continuar donde lo dejaste/ });
    await waitFor(() => expect(resume).toBeEnabled());
    fireEvent.click(resume);
    await screen.findByRole("heading", { name: "¿Cómo quieres que piense Kira?" });
    expect(screen.getByText(/Ollama ya no está disponible/)).toBeInTheDocument();
  });

  it("applies the saved language", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    captureCheckpoint();
    renderFlow({ checkpoint: cp("voice", { ...LOCAL, language: "en" }) });
    await screen.findByRole("heading", { name: "Pick up where you left off?" });
    const resume = await screen.findByRole("button", { name: "Continue where you left off (Voice)" });
    await waitFor(() => expect(resume).toBeEnabled());
    fireEvent.click(resume);
    await screen.findByRole("heading", { name: "Which voice do you prefer?" });
  });

  it("start over clears the checkpoint and opens the first screen", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    const writes = captureCheckpoint();
    renderFlow({ checkpoint: cp("voice", LOCAL) });
    fireEvent.click(await screen.findByRole("button", { name: "Empezar de nuevo" }));
    await screen.findByRole("heading", { name: "Idioma · Language" });
    await waitFor(() => expect(writes).toContain("DELETE"));
  });

  it("says plainly when a saved checkpoint could not be recovered", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    captureCheckpoint();
    renderFlow({ checkpointReset: true });
    await screen.findByRole("heading", { name: "Idioma · Language" });
    expect(screen.getByText("No pude recuperar tu avance, empezamos de nuevo.")).toBeInTheDocument();
  });

  it("ignores the checkpoint on a re-opened completed setup", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    captureCheckpoint();
    renderFlow({ resume: true, checkpoint: cp("voice", LOCAL) });
    await screen.findByRole("heading", { name: "Todo listo" });
    expect(screen.queryByRole("button", { name: /Continuar donde lo dejaste/ })).not.toBeInTheDocument();
  });

  it("resumes a saved fallback checkpoint directly on test when Ollama is missing", async () => {
    useFixtures(cpuReadiness([], false));
    server.use(
      http.get(`${API_BASE_URL}/api/llm/provider`, () =>
        HttpResponse.json({
          ...defaultLlmProvider,
          active_provider: "openai",
          profiles: {
            openai: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", preset: "openai", api_key_set: true }
          }
        })
      )
    );
    captureCheckpoint();
    renderFlow({
      checkpoint: cp("fallback", {
        engine: "cloud",
        cloud_preset: "openai",
        cloud_model: "gpt-4o-mini",
        voice: "ok",
        hear_kira: false,
        language: "es"
      })
    });
    const resume = await screen.findByRole("button", { name: /Continuar donde lo dejaste/ });
    await waitFor(() => expect(resume).toBeEnabled());
    fireEvent.click(resume);
    await screen.findByRole("heading", { name: "Prueba de velocidad" });
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await screen.findByRole("heading", { name: "Conecta tu proveedor" });
  });
});

describe("SetupFlow — /setup <section> (S10)", () => {
  it("opens the asked block on a completed setup and returns to the summary", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    captureCheckpoint();
    renderFlow({ variant: "panel", resume: true, section: { kind: "step", step: "theme" } });
    await screen.findByRole("heading", { name: "Tema de la app" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("heading", { name: "Todo listo" });
  });

  it("an unknown section opens the summary with a short note", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    captureCheckpoint();
    renderFlow({ variant: "panel", resume: true, section: { kind: "unknown" } });
    await screen.findByRole("heading", { name: "Todo listo" });
    expect(screen.getByText("No conozco esa parte. Aquí tienes el resumen.")).toBeInTheDocument();
  });

  it("before setup is finished, a section waits for the normal flow and says so", async () => {
    useFixtures(cpuReadiness(["qwen3:1.7b"]));
    captureCheckpoint();
    renderFlow({ variant: "panel", section: { kind: "step", step: "voice" } });
    await screen.findByRole("heading", { name: "Idioma · Language" });
    expect(screen.getByText(/Primero terminemos la configuración/)).toBeInTheDocument();
  });
});
