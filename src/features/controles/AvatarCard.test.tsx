import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
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

function fileInput(): HTMLInputElement {
  const container = document.querySelector(".flex.flex-col.p-4") ?? document.body;
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input not found");
  return input;
}

function pngFile(name = "kira-angry.png"): File {
  // Minimal PNG header — the MSW mock does not inspect bytes.
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "image/png" });
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

describe("AvatarCard per-state upload POSTs bytes (tauri_avatar_upload_20260911)", () => {
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

  it("POSTs {state, filename, content_b64} and shows the stored path once it lands", async () => {
    // Surgical stub: keep the URL constructor intact for MSW, only add the
    // jsdom-missing createObjectURL so the instant-preview path is exercised.
    const urlCtor = URL as unknown as Record<string, unknown>;
    const hadFactory = "createObjectURL" in URL;
    urlCtor["createObjectURL"] = () => "blob:preview";
    try {
      let capturedBody: { state?: string; filename?: string; content_b64?: string } | undefined;
      server.use(
        http.post(`${API_BASE_URL}/api/avatar/upload`, async ({ request }) => {
          capturedBody = (await request.json()) as typeof capturedBody;
          return HttpResponse.json({
            ...defaultAvatarConfig,
            state_images: { ...defaultAvatarConfig.state_images, angry: "user/angry.png" }
          });
        })
      );

      await clickChange("enfadada");
      fireEvent.change(fileInput(), { target: { files: [pngFile()] } });

      await waitFor(() => expect(capturedBody?.state).toBe("angry"));
      expect(capturedBody?.filename).toBe("kira-angry.png");
      expect(typeof capturedBody?.content_b64).toBe("string");
      expect((capturedBody?.content_b64 ?? "").length).toBeGreaterThan(0);
      await waitFor(() => expect(screen.getByText("user/angry.png")).toBeInTheDocument());
    } finally {
      if (!hadFactory) delete urlCtor["createObjectURL"];
    }
  });

  it("treats an empty file selection as a no-op, not an error", async () => {
    let postCount = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/avatar/upload`, async () => {
        postCount += 1;
        return HttpResponse.json(defaultAvatarConfig);
      })
    );

    await clickChange("enfadada");
    fireEvent.change(fileInput(), { target: { files: [] } });

    await waitFor(() => expect(screen.queryByText("Subiendo…")).not.toBeInTheDocument());
    expect(postCount).toBe(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces an upload 422 honestly", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/avatar/upload`, () =>
        HttpResponse.json({ detail: "Unsupported image format" }, { status: 422 })
      )
    );

    await clickChange("enfadada");
    fireEvent.change(fileInput(), { target: { files: [pngFile()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unsupported image format"));
  });

  it("refuses oversized files client-side before any POST", async () => {
    let postCount = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/avatar/upload`, async () => {
        postCount += 1;
        return HttpResponse.json(defaultAvatarConfig);
      })
    );

    await clickChange("enfadada");
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" });
    fireEvent.change(fileInput(), { target: { files: [big] } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("too large"));
    expect(postCount).toBe(0);
  });

  it("revokes the blob preview on success so the served URL takes over", async () => {
    const urlCtor = URL as unknown as Record<string, unknown>;
    const revoked: string[] = [];
    const hadCreate = "createObjectURL" in URL;
    const hadRevoke = "revokeObjectURL" in URL;
    urlCtor["createObjectURL"] = () => "blob:preview";
    urlCtor["revokeObjectURL"] = (url: string) => revoked.push(url);
    try {
      await clickChange("enfadada");
      fireEvent.change(fileInput(), { target: { files: [pngFile()] } });

      // Served mapping wins once the upload lands…
      await waitFor(() => expect(screen.getByText("user/angry.png")).toBeInTheDocument());
      expect(revoked).toEqual(["blob:preview"]);
      // …and the served thumbnail (not the blob) is what renders.
      const thumb = screen.getByRole("img", { name: "Vista previa — enfadada" }) as HTMLImageElement;
      expect(thumb.src).toContain("avatar/image?state=angry");
    } finally {
      if (!hadCreate) delete urlCtor["createObjectURL"];
      if (!hadRevoke) delete urlCtor["revokeObjectURL"];
    }
  });

  it("renders a served thumbnail per configured state, placeholder when unset", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/config`, () =>
        HttpResponse.json({ ...defaultAvatarConfig, state_images: {} })
      )
    );
    renderCard();
    await screen.findByRole("combobox", { name: "Modo" });

    // No configured states: no thumbnails, eight honest "sin imagen" rows.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getAllByText("sin imagen")).toHaveLength(8);
  });
});
