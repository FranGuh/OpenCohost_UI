import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  avatarConfigGetErrorHandler,
  avatarConfigPutValidationHandler,
  defaultAvatarConfig
} from "../../test/handlers.js";
import { AvatarCard } from "./AvatarCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(AvatarCard)));
}

function selectCustomOption(comboboxName: string | RegExp, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("AvatarCard populates from GET /api/avatar/config", () => {
  it("renders the mode and one row per state with its configured image path", async () => {
    renderCard();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Modo" })).toHaveTextContent("Imágenes por estado")
    );
    expect(screen.getByText(defaultAvatarConfig.state_images.idle)).toBeInTheDocument();
    expect(screen.getByText(defaultAvatarConfig.state_images.speaking)).toBeInTheDocument();
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded config", async () => {
    server.use(avatarConfigGetErrorHandler());
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "Modo" })).not.toBeInTheDocument();
  });
});

describe("AvatarCard mode change PUTs the edited config", () => {
  it("fires PUT /api/avatar/config with the new mode on change", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/config`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultAvatarConfig, mode: "static" });
      })
    );
    renderCard();

    await screen.findByRole("combobox", { name: "Modo" });
    selectCustomOption("Modo", "Estático");

    await waitFor(() => expect(capturedBody).toEqual({ mode: "static" }));
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });

  it("surfaces a PUT 422 validation error honestly", async () => {
    server.use(avatarConfigPutValidationHandler("unknown avatar state(s): bogus"));
    renderCard();

    await screen.findByRole("combobox", { name: "Modo" });
    selectCustomOption("Modo", "Estático");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unknown avatar state(s): bogus"));
  });
});

describe("AvatarCard per-state image upload stays disabled (no upload endpoint)", () => {
  it("renders a disabled Cambiar affordance per state row with a role=status note", async () => {
    renderCard();
    await screen.findByRole("combobox", { name: "Modo" });
    const changeButtons = screen.getAllByRole("button", { name: /^Cambiar imagen/ });
    expect(changeButtons.length).toBeGreaterThan(0);
    changeButtons.forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByText(/necesitaría subida multipart/i)).toBeInTheDocument();
  });
});
