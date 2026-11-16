import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { initialSetupState } from "./setupMachine.js";
import { InferenceTestStep } from "./InferenceTestStep.js";

function failWith(http_status: number, provider_message: string | null, error_code = "cloud_rate_limit") {
  server.use(
    http.post(`${API_BASE_URL}/api/setup/inference-test`, () =>
      HttpResponse.json({
        status: "failed", provider: "cloud", model: "gemini", runs: [], error_code, http_status, provider_message,
        metrics: { load_ms: null, first_token_ms: null, tokens_per_second: null }
      })
    )
  );
}

function renderStep() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <InferenceTestStep state={{ ...initialSetupState(), step: "test" }} dispatch={vi.fn()} expectedModel={null} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useUiLocaleStore.getState().setLocale("es");
});

describe("InferenceTestStep — failure detail", () => {
  it("shows only the HTTP status when the provider sent no message", async () => {
    failWith(402, null);
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));
    expect(await screen.findByText("HTTP 402")).toBeInTheDocument();
    expect(screen.getByText(/Sin créditos o llegaste al límite/)).toBeInTheDocument();
  });

  it("tells the user to restart OpenCohost when the test request itself fails", async () => {
    server.use(http.post(`${API_BASE_URL}/api/setup/inference-test`, () => new HttpResponse(null, { status: 500 })));
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));
    expect(await screen.findByText(/Reinicia OpenCohost e inténtalo otra vez/)).toBeInTheDocument();
  });

  it("shows a spinner and active measuring status while the inference test is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.post(`${API_BASE_URL}/api/setup/inference-test`, async () => {
        await gate;
        return HttpResponse.json({
          status: "passed", provider: "local", model: "qwen3:1.7b", runs: [], error_code: null,
          metrics: { load_ms: 100, first_token_ms: 200, tokens_per_second: 30 }
        });
      })
    );
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar prueba" }));

    const runningBtn = await screen.findByRole("button", { name: "Midiendo…" });
    expect(runningBtn).toBeDisabled();
    expect(runningBtn.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Midiendo/);

    release();
    expect(await screen.findByText("Bien para directo.")).toBeInTheDocument();
  });
});
