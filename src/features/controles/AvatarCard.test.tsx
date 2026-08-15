import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  avatarConfigGetErrorHandler,
  avatarConfigPutValidationHandler,
  defaultAvatarConfig
} from "../../test/handlers.js";

// Module-scope spy read lazily inside the factory (the repo's
// @tauri-apps/api/core mock convention) — jsdom has no native picker.
const openDialog = vi.fn<(options?: unknown) => Promise<string | null>>();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (options?: unknown) => openDialog(options)
}));

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

describe("AvatarCard per-state image picks a real path through the native dialog", () => {
  beforeEach(() => openDialog.mockReset());

  async function clickChange(stateLabel: string) {
    renderCard();
    await screen.findByRole("combobox", { name: "Modo" });
    fireEvent.click(screen.getByRole("button", { name: `Cambiar imagen — ${stateLabel}` }));
  }

  it("renders one enabled Cambiar affordance per state row", async () => {
    renderCard();
    await screen.findByRole("combobox", { name: "Modo" });
    const changeButtons = screen.getAllByRole("button", { name: /^Cambiar imagen/ });
    expect(changeButtons).toHaveLength(8);
    changeButtons.forEach((button) => expect(button).not.toBeDisabled());
  });

  it("filters the dialog to image types and PUTs the picked path merged into state_images", async () => {
    openDialog.mockResolvedValue("C:\\avatars\\kira-angry.png");
    let capturedBody: { state_images?: Record<string, string> } | undefined;
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/config`, async ({ request }) => {
        capturedBody = (await request.json()) as { state_images?: Record<string, string> };
        return HttpResponse.json({ ...defaultAvatarConfig, ...capturedBody });
      })
    );

    await clickChange("enfadada");

    await waitFor(() => expect(capturedBody?.state_images?.angry).toBe("C:\\avatars\\kira-angry.png"));
    expect(openDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        directory: false,
        filters: [expect.objectContaining({ extensions: expect.arrayContaining(["png", "jpg", "webp"]) })]
      })
    );
  });

  it("never drops the other states — every untouched path survives the PUT", async () => {
    openDialog.mockResolvedValue("C:\\avatars\\kira-idle.png");
    let capturedBody: { state_images?: Record<string, string> } | undefined;
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/config`, async ({ request }) => {
        capturedBody = (await request.json()) as { state_images?: Record<string, string> };
        return HttpResponse.json({ ...defaultAvatarConfig, ...capturedBody });
      })
    );

    await clickChange("en vivo");

    await waitFor(() => expect(capturedBody?.state_images?.idle).toBe("C:\\avatars\\kira-idle.png"));
    // Every state other than the one just changed keeps its configured path.
    Object.entries(defaultAvatarConfig.state_images)
      .filter(([state]) => state !== "idle")
      .forEach(([state, path]) => expect(capturedBody?.state_images?.[state]).toBe(path));
  });

  it("treats a cancelled dialog as a no-op, not an error", async () => {
    openDialog.mockResolvedValue(null);
    let putCount = 0;
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/config`, async () => {
        putCount += 1;
        return HttpResponse.json(defaultAvatarConfig);
      })
    );

    await clickChange("enfadada");

    await waitFor(() => expect(openDialog).toHaveBeenCalled());
    expect(putCount).toBe(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the new path in the row and in Probar's preview once the PUT lands", async () => {
    openDialog.mockResolvedValue("C:\\avatars\\kira-idle.png");
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/config`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...defaultAvatarConfig, ...body });
      })
    );

    await clickChange("en vivo");
    await waitFor(() => expect(screen.getByText("C:\\avatars\\kira-idle.png")).toBeInTheDocument());

    // Probar defaults to the "idle" state, so its swatch must read the path
    // that was just written — no extra endpoint involved.
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /en vivo/ })).toHaveAttribute("src", "C:\\avatars\\kira-idle.png")
    );
  });
});
