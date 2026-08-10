import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  commandConflictHandler,
  commandNetworkErrorHandler,
  commandValidationHandler,
  defaultModels,
  evolvingCurrentModelHandler,
  frozenStatusHandler
} from "../../test/handlers.js";
import { ModelCard } from "./ModelCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ModelCard)));
}

describe("ModelCard populates from GET /api/models", () => {
  it("shows the live current_model, catalog options, and active tier", async () => {
    renderCard();

    await waitFor(() => expect(screen.getAllByText(defaultModels.current_model as string).length).toBeGreaterThan(0));

    const select = screen.getByRole("combobox", { name: "Modelo Activo" }) as HTMLSelectElement;
    expect(select.value).toBe(defaultModels.current_model);
    expect(screen.getByText("Qwen 3 (1.7B) ⚡", { selector: "option" })).toBeInTheDocument();

    const activeTierButton = screen.getByRole("button", { name: /Fast ⚡ · Qwen 3 \(1\.7B\)/ });
    expect(activeTierButton).toHaveAttribute("aria-pressed", "true");
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

    const select = screen.getByRole("combobox", { name: "Modelo Activo" }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("qwen3:1.7b"));

    fireEvent.change(select, { target: { value: "llama3.2:3b" } });

    expect(select.value).toBe("llama3.2:3b");
    expect(select).toBeDisabled();
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    // independence — tier buttons stay enabled while only the model select applies
    expect(screen.getByRole("button", { name: /Fast ⚡/ })).not.toBeDisabled();

    await waitFor(() => expect(select).not.toBeDisabled());
    await waitFor(() => expect(screen.getByText("instalado")).toBeInTheDocument());
  });
});

describe("ModelCard switch_llm_tier — accepted -> poll -> applied", () => {
  it("dispatches switch_llm_tier, disables only the tier group while pending, converges optimistically (state_version pinned, never advances)", async () => {
    server.use(frozenStatusHandler(1));
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-tier", status: "queued", state_version: 1 })
      )
    );
    renderCard();

    const qualityTier = await screen.findByRole("button", { name: /Quality · Gemma 4/ });
    fireEvent.click(qualityTier);

    expect(qualityTier).toHaveAttribute("aria-pressed", "true");
    expect(qualityTier).toBeDisabled();
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    // independence — the model select stays enabled while only the tier applies
    expect(screen.getByRole("combobox", { name: "Modelo Activo" })).not.toBeDisabled();

    await waitFor(() => expect(qualityTier).not.toBeDisabled());
    await waitFor(() => expect(screen.getByText("instalado")).toBeInTheDocument());
  });
});

describe("ModelCard command errors surface honestly", () => {
  it("shows a 409 conflict alert and re-enables the control", async () => {
    server.use(commandConflictHandler());
    renderCard();

    const select = await screen.findByRole("combobox", { name: "Modelo Activo" });
    fireEvent.change(select, { target: { value: "llama3.2:3b" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
    expect(select).not.toBeDisabled();
  });

  it("shows a 422 validation alert with the backend detail", async () => {
    server.use(commandValidationHandler("switch_model requires a non-None string value"));
    renderCard();

    const select = await screen.findByRole("combobox", { name: "Modelo Activo" });
    fireEvent.change(select, { target: { value: "llama3.2:3b" } });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("switch_model requires a non-None string value")
    );
  });

  it("shows a network-error alert", async () => {
    server.use(commandNetworkErrorHandler());
    renderCard();

    const select = await screen.findByRole("combobox", { name: "Modelo Activo" });
    fireEvent.change(select, { target: { value: "llama3.2:3b" } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("ModelCard download control (still mock — no backend download endpoint)", () => {
  it("shows a simulated progress bar and not-wired status note while the mock download runs", async () => {
    renderCard();
    await screen.findByRole("combobox", { name: "Modelo Activo" });
    fireEvent.click(screen.getByRole("button", { name: "Descargar" }));

    const downloadStatus = screen.getAllByRole("status").find((node) => node.textContent?.includes("Descargando"));
    expect(downloadStatus).toBeDefined();
    expect(downloadStatus).toHaveTextContent(/backend/);

    await waitFor(() => expect(screen.queryByText(/Descargando/)).not.toBeInTheDocument());
  });
});
