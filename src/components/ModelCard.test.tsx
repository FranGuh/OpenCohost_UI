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

  it("defaults the tier control to Fast and switches active tier locally on click", () => {
    renderCard();
    const fastTier = screen.getByRole("button", { name: /Fast · Qwen 3/ });
    const qualityTier = screen.getByRole("button", { name: /Quality · Gemma 4/ });
    expect(fastTier).toHaveAttribute("aria-pressed", "true");
    expect(qualityTier).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(qualityTier);

    expect(qualityTier).toHaveAttribute("aria-pressed", "true");
    expect(fastTier).toHaveAttribute("aria-pressed", "false");
  });

  it("updates the meta description when a different model is selected", () => {
    renderCard();
    const select = screen.getByLabelText("Modelo Activo") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "llama3-8b" } });
    expect(select.value).toBe("llama3-8b");
    expect(screen.getByText("4.8 GB")).toBeInTheDocument();
  });
});
