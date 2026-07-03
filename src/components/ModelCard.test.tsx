import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { defaultStatus } from "../test/handlers.js";
import { ModelCard } from "./ModelCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ModelCard)));
}

describe("ModelCard", () => {
  it("shows the live current_model from useStatusQuery", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText(defaultStatus.current_model as string)).toBeInTheDocument());
  });

  it("renders a not-wired status note disclosing model/tier are local previews", () => {
    renderCard();
    expect(screen.getByRole("status")).toHaveTextContent(/vistas previas locales/);
  });

  it("defaults the tier control to Fast and applies a tier switch through the mock command", async () => {
    renderCard();
    const fastTier = screen.getByRole("button", { name: /Fast · Qwen 3/ });
    const qualityTier = screen.getByRole("button", { name: /Quality · Gemma 4/ });
    expect(fastTier).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("instalado")).toBeInTheDocument();

    fireEvent.click(qualityTier);

    expect(qualityTier).toHaveAttribute("aria-pressed", "true");
    expect(fastTier).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("aplicando…")).toBeInTheDocument();
    expect(qualityTier).toBeDisabled();

    // independence — the model select stays enabled while only the tier applies
    expect(screen.getByRole("combobox", { name: "Modelo Activo" })).not.toBeDisabled();

    await waitFor(() => expect(screen.getByText("instalado")).toBeInTheDocument());
    expect(qualityTier).not.toBeDisabled();
  });

  it("updates the meta description and applies through the mock command when a different model is selected", async () => {
    renderCard();
    const select = screen.getByRole("combobox", { name: "Modelo Activo" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "llama3-8b" } });

    expect(select.value).toBe("llama3-8b");
    expect(screen.getByText("4.8 GB")).toBeInTheDocument();
    expect(select).toBeDisabled();

    // independence — the tier buttons stay enabled while only the model select applies
    expect(screen.getByRole("button", { name: /Fast · Qwen 3/ })).not.toBeDisabled();

    await waitFor(() => expect(select).not.toBeDisabled());
  });

  it("shows a simulated progress bar and not-wired status note while the mock download runs", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Descargar" }));

    const downloadStatus = screen.getAllByRole("status").find((node) => node.textContent?.includes("Descargando"));
    expect(downloadStatus).toBeDefined();
    expect(downloadStatus).toHaveTextContent(/backend/);

    await waitFor(() => expect(screen.queryByText(/Descargando/)).not.toBeInTheDocument());
  });
});
