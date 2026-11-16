import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../avatar-vrm/components/VrmStage.js", () => ({ VrmStage: () => null }));
vi.mock("../desktop-companion/desktopClient.js", () => ({
  getDesktopState: vi.fn().mockResolvedValue({ enabled: false, visible: false, model: null }),
  onDesktopState: vi.fn().mockResolvedValue(() => {}),
  setDesktopMode: vi.fn()
}));

import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { useStageControlsStore } from "../../store/stageControlsStore.js";
import { useWelcomeStore } from "../../store/welcomeStore.js";
import { ToastProvider } from "../../ui/Toast.js";
import { AppLayout } from "./AppLayout.js";
import { TitleBar } from "./TitleBar.js";

beforeEach(() => {
  window.localStorage.clear();
  useWelcomeStore.setState({ dismissed: true });
  useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "model.vrm" });
  useStageControlsStore.setState({ framingMode: "half", qaRunning: false, qaIndex: 0, stage3dMounted: true });
});

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TitleBar />
        <AppLayout />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("title bar stage controls", () => {
  it("shows the camera chip and desktop controls inside the title bar while the stage is active", async () => {
    renderApp();
    const bar = screen.getByRole("banner");
    const cameraChip = await within(bar).findByRole("button", { name: "Encuadre de cámara" });
    expect(cameraChip).toBeInTheDocument();
    expect(await within(bar).findByRole("button", { name: "Modo escritorio" })).toBeInTheDocument();

    // Open popover to access framing options and animation test
    fireEvent.click(cameraChip);
    expect(within(bar).getByRole("button", { name: "Cuerpo" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Probar animaciones" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cuerpo" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Modo escritorio" })).toHaveLength(1);
  });

  it("removes them when another sidebar section is active", async () => {
    renderApp();
    const bar = screen.getByRole("banner");
    const cameraChip = await within(bar).findByRole("button", { name: "Encuadre de cámara" });
    expect(cameraChip).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Controles/ }));
    expect(within(bar).queryByRole("button", { name: "Encuadre de cámara" })).not.toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Modo escritorio" })).not.toBeInTheDocument();
  });
});
