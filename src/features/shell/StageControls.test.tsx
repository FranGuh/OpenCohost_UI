import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setDesktopMode = vi.fn();
vi.mock("../desktop-companion/desktopClient.js", () => ({
  getDesktopState: vi.fn().mockResolvedValue({ enabled: false, visible: false, model: null }),
  onDesktopState: vi.fn().mockResolvedValue(() => {}),
  setDesktopMode: (...args: unknown[]) => setDesktopMode(...args)
}));

import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { useStageControlsStore } from "../../store/stageControlsStore.js";
import { StageControls } from "./StageControls.js";

beforeEach(() => {
  window.localStorage.clear();
  setDesktopMode.mockReset().mockResolvedValue({ enabled: true, visible: true, model: "model.vrm" });
  useStageControlsStore.setState({ framingMode: "half", qaRunning: false, qaIndex: 0, stage3dMounted: true });
  useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "model.vrm" });
});

describe("StageControls", () => {
  it("renders the camera popover chip and opens framing options and animation test", async () => {
    render(<StageControls />);
    const cameraChip = screen.getByRole("button", { name: "Encuadre de cámara" });
    expect(cameraChip).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Modo escritorio" })).toBeInTheDocument();

    // Open camera popover
    fireEvent.click(cameraChip);
    expect(screen.getByRole("button", { name: "Cuerpo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Medio" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Rostro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Probar animaciones" })).toBeInTheDocument();
  });

  it("drives the stage framing through the shared store", () => {
    render(<StageControls />);
    fireEvent.click(screen.getByRole("button", { name: "Encuadre de cámara" }));
    fireEvent.click(screen.getByRole("button", { name: "Rostro" }));
    expect(useStageControlsStore.getState().framingMode).toBe("head");
    expect(screen.getByRole("button", { name: "Rostro" })).toHaveAttribute("aria-pressed", "true");
  });

  it("starts and stops the animation test through the shared store", () => {
    render(<StageControls />);
    fireEvent.click(screen.getByRole("button", { name: "Encuadre de cámara" }));
    fireEvent.click(screen.getByRole("button", { name: "Probar animaciones" }));
    expect(useStageControlsStore.getState().qaRunning).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Detener QA" }));
    expect(useStageControlsStore.getState().qaRunning).toBe(false);
  });

  it("desktop-mode button enables the companion with the selected model, as before", async () => {
    render(<StageControls />);
    fireEvent.click(await screen.findByRole("button", { name: "Modo escritorio" }));
    await waitFor(() => expect(setDesktopMode).toHaveBeenCalledWith(true, "model.vrm"));
  });

  it("hides the framing and animation controls when the 3D stage is not mounted but keeps desktop mode", async () => {
    useStageControlsStore.setState({ stage3dMounted: false });
    render(<StageControls />);
    expect(screen.queryByRole("button", { name: "Encuadre de cámara" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cuerpo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Probar animaciones" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Modo escritorio" })).toBeInTheDocument();
  });

  it("keeps every interactive control out of a drag region", async () => {
    const { container } = render(<StageControls />);
    await screen.findByRole("button", { name: "Modo escritorio" });
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect(button.closest("[data-tauri-drag-region]")).toBeNull();
    }
  });
});
