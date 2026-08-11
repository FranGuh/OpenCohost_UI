import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  cloudModels,
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

/** Switch the model CustomSelect to `optionName`. Mirrors ProviderCard.test.tsx's pickActiveProvider. */
function pickModel(optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Modelo Activo" }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("ModelCard populates from GET /api/models", () => {
  it("shows the live current_model, catalog options, and active tier", async () => {
    renderCard();

    await waitFor(() => expect(screen.getAllByText(defaultModels.current_model as string).length).toBeGreaterThan(0));

    expect(screen.getByRole("combobox", { name: "Modelo Activo" })).toHaveTextContent("Qwen 3 (1.7B) ⚡");

    fireEvent.click(screen.getByRole("combobox", { name: "Modelo Activo" }));
    expect(screen.getByRole("option", { name: "Qwen 3 (1.7B) ⚡" })).toBeInTheDocument();

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

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));

    pickModel("LLaMA 3.2 (3B)");

    expect(trigger).toHaveTextContent("LLaMA 3.2 (3B)");
    expect(trigger).toBeDisabled();
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    // independence — tier buttons stay enabled while only the model select applies
    expect(screen.getByRole("button", { name: /Fast ⚡/ })).not.toBeDisabled();

    await waitFor(() => expect(trigger).not.toBeDisabled());
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

describe("ModelCard never downloads models — Ollama does (owner decision)", () => {
  it("shows the Ollama management hint and no download control", async () => {
    renderCard();
    await screen.findByRole("combobox", { name: "Modelo Activo" });

    expect(screen.getByText(/Ollama/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descargar" })).not.toBeInTheDocument();
  });
});

describe("ModelCard availability marking from `discovered` (fail-open per settings.py)", () => {
  it("marks a not-installed catalog entry as disabled and refuses to select it", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: ["qwen3:1.7b"] }))
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

  it("marks NO option as unavailable when discovery is empty — cannot verify, not 'nothing installed'", async () => {
    server.use(http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json({ ...defaultModels, discovered: [] })));
    renderCard();

    const trigger = screen.getByRole("combobox", { name: "Modelo Activo" });
    await waitFor(() => expect(trigger).toHaveTextContent("Qwen 3 (1.7B) ⚡"));
    fireEvent.click(trigger);

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    options.forEach((option) => expect(option).not.toHaveAttribute("aria-disabled", "true"));
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
    expect(screen.queryByRole("button", { name: /Fast ⚡/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ollama/)).not.toBeInTheDocument();
  });
});
