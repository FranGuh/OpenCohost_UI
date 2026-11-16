import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultAvatarConfig } from "../../test/handlers.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { AvatarCard } from "./AvatarCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(AvatarCard))
  );
}

describe("AvatarCard Presentation Mode (2D / 3D)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAvatarPresentationStore.setState({ mode: "2d", selectedModel: "" });
  });

  it("renders presentation mode selector defaulting to 2D", async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Tipo de presentación" })).toHaveTextContent(
        "2D (Imágenes clásicas)"
      );
    });
    // 2D mode select is present
    expect(screen.getByRole("combobox", { name: "Modo" })).toBeInTheDocument();
    // 2D image states are visible
    expect(screen.getByText(defaultAvatarConfig.state_images.idle)).toBeInTheDocument();
  });

  it("switches to 3D and displays VRM model selector while hiding 2D image states", async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Tipo de presentación" })).toBeInTheDocument();
    });

    // Switch to 3D
    fireEvent.click(screen.getByRole("combobox", { name: "Tipo de presentación" }));
    fireEvent.click(screen.getByRole("option", { name: "3D (Avatar VRM)" }));

    // Store is updated
    expect(useAvatarPresentationStore.getState().mode).toBe("3d");

    // VRM model selector is displayed
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Modelo VRM activo" })).toBeInTheDocument();
    });

    // 2D mode select is hidden
    expect(screen.queryByRole("combobox", { name: "Modo" })).not.toBeInTheDocument();
    // 2D image states are hidden
    expect(screen.queryByText(defaultAvatarConfig.state_images.idle)).not.toBeInTheDocument();
  });

  it("shows empty message when no VRM models are found in 3D mode", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/list`, () => HttpResponse.json([]))
    );
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "" });

    renderCard();
    await waitFor(() => {
      expect(
        screen.getByText("No se encontraron modelos .vrm en C:\\vrm-default. Usa Cambiar carpeta para elegir otra.")
      ).toBeInTheDocument();
    });
  });

  it("does not fetch VRM models in 2D mode, only fetches when switched to 3D", async () => {
    let fetchCount = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/list`, () => {
        fetchCount++;
        return HttpResponse.json([]);
      })
    );

    renderCard();
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Tipo de presentación" })).toBeInTheDocument();
    });

    // In 2D mode, query is disabled
    expect(fetchCount).toBe(0);

    // Switch to 3D
    fireEvent.click(screen.getByRole("combobox", { name: "Tipo de presentación" }));
    fireEvent.click(screen.getByRole("option", { name: "3D (Avatar VRM)" }));

    // Now query fires
    await waitFor(() => {
      expect(fetchCount).toBe(1);
    });
  });
});
