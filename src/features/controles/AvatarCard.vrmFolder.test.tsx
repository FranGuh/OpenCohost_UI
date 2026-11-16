import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { AvatarCard } from "./AvatarCard.js";

const pickFolder = vi.fn<(defaultPath?: string) => Promise<string | null>>();
vi.mock("../../lib/pickFolder.js", () => ({
  pickFolder: (defaultPath?: string) => pickFolder(defaultPath)
}));

const BUNDLED = { filename: "Opencohost Kira v3.vrm", size_mb: 20, modified_at: 1, bundled: true };
const OTHER = { filename: "mine.vrm", size_mb: 5, modified_at: 2, bundled: false };

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(AvatarCard))
  );
}

function folderState(path: string, source: "saved" | "env" | "default", count = 0) {
  return { path, source, exists: true, model_count: count };
}

const LONG = "C:\\Users\\someone\\Documents\\Mis cosas\\Avatares\\Modelos de Kira\\Coleccion personal";

describe("AvatarCard VRM models folder (T9)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "" });
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    pickFolder.mockReset();
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("shows the folder path with its full text as a tooltip and an origin label", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/folder`, () => HttpResponse.json(folderState(LONG, "saved", 1))),
      http.get(`${API_BASE_URL}/api/avatar/vrm/list`, () => HttpResponse.json([BUNDLED, OTHER]))
    );
    renderCard();
    const path = await screen.findByTestId("vrm-folder-path");
    expect(path).toHaveAttribute("title", LONG);
    expect(path.textContent).toContain("…");
    expect(path.textContent!.length).toBeLessThan(LONG.length);
    expect(screen.getByText("elegida por ti")).toBeInTheDocument();
  });

  it("labels the default origin and hides Use default when nothing is saved", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/folder`, () =>
        HttpResponse.json(folderState("C:\\default", "default"))
      )
    );
    renderCard();
    expect(await screen.findByText("carpeta predeterminada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar la predeterminada" })).not.toBeInTheDocument();
  });

  it("marks the bundled model as included in the picker", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/list`, () => HttpResponse.json([BUNDLED, OTHER]))
    );
    renderCard();
    const select = await screen.findByRole("combobox", { name: "Modelo VRM activo" });
    await waitFor(() => expect(select).toHaveTextContent("incluido"));
  });

  it("Change folder opens the picker, PUTs the choice and refreshes the list at once", async () => {
    let folder = folderState("C:\\default", "default");
    let models = [BUNDLED];
    let putBody: unknown = null;
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/folder`, () => HttpResponse.json(folder)),
      http.get(`${API_BASE_URL}/api/avatar/vrm/list`, () => HttpResponse.json(models)),
      http.put(`${API_BASE_URL}/api/avatar/vrm/folder`, async ({ request }) => {
        putBody = await request.json();
        folder = folderState("D:\\modelos", "saved", 1);
        models = [BUNDLED, OTHER];
        return HttpResponse.json(folder);
      })
    );
    pickFolder.mockResolvedValue("D:\\modelos");
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar carpeta" }));
    await waitFor(() => expect(putBody).toEqual({ path: "D:\\modelos" }));
    expect(pickFolder).toHaveBeenCalledWith("C:\\default");
    expect(await screen.findByText("D:\\modelos")).toBeInTheDocument();
    expect(await screen.findByText("elegida por ti")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Usar la predeterminada" })).toBeInTheDocument();
    // list refetched without a reload: the new model is in the picker data
    fireEvent.click(screen.getByRole("combobox", { name: "Modelo VRM activo" }));
    expect(await screen.findByRole("option", { name: /mine\.vrm/ })).toBeInTheDocument();
  });

  it("a cancelled picker changes nothing and sends no request", async () => {
    let puts = 0;
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/vrm/folder`, () => {
        puts++;
        return HttpResponse.json(folderState("x", "saved"));
      })
    );
    pickFolder.mockResolvedValue(null);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar carpeta" }));
    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
    expect(puts).toBe(0);
  });

  it("maps a server error code to a localized message", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/vrm/folder`, () =>
        HttpResponse.json({ detail: "path_network_or_device" }, { status: 422 })
      )
    );
    pickFolder.mockResolvedValue("\\\\server\\share");
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar carpeta" }));
    expect(
      await screen.findByText("No se admiten carpetas de red ni rutas de dispositivo. Elige una carpeta local.")
    ).toBeInTheDocument();
  });

  it("Use default clears the saved folder", async () => {
    let folder = folderState("D:\\modelos", "saved", 0);
    let deleted = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/folder`, () => HttpResponse.json(folder)),
      http.delete(`${API_BASE_URL}/api/avatar/vrm/folder`, () => {
        deleted++;
        folder = folderState("C:\\default", "default");
        return HttpResponse.json(folder);
      })
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Usar la predeterminada" }));
    await waitFor(() => expect(deleted).toBe(1));
    expect(await screen.findByText("carpeta predeterminada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar la predeterminada" })).not.toBeInTheDocument();
  });

  it("the empty state names the folder and points to Change folder", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/folder`, () =>
        HttpResponse.json(folderState("D:\\vacia", "saved", 0))
      ),
      http.get(`${API_BASE_URL}/api/avatar/vrm/list`, () => HttpResponse.json([]))
    );
    renderCard();
    expect(
      await screen.findByText(
        "No se encontraron modelos .vrm en D:\\vacia. Usa Cambiar carpeta para elegir otra."
      )
    ).toBeInTheDocument();
  });

  it("falls back to the bundled model when the selected one is not in the new list", async () => {
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "gone.vrm" });
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/list`, () => HttpResponse.json([OTHER, BUNDLED]))
    );
    renderCard();
    await waitFor(() =>
      expect(useAvatarPresentationStore.getState().selectedModel).toBe("Opencohost Kira v3.vrm")
    );
  });

  it("keeps a still-valid selection", async () => {
    useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "mine.vrm" });
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/list`, () => HttpResponse.json([BUNDLED, OTHER]))
    );
    renderCard();
    await screen.findByRole("combobox", { name: "Modelo VRM activo" });
    expect(useAvatarPresentationStore.getState().selectedModel).toBe("mine.vrm");
  });

  it("outside Tauri the picker button is disabled with an explanation", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    renderCard();
    const button = await screen.findByRole("button", { name: "Cambiar carpeta" });
    expect(button).toBeDisabled();
    expect(
      screen.getByText("El selector de carpetas solo está disponible en la app de escritorio.")
    ).toBeInTheDocument();
  });
});
