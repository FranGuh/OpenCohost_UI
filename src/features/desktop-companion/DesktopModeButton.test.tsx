import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopModeButton } from "./DesktopModeButton.js";
import type { DesktopSnapshot } from "./desktopClient.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";

const mockGetDesktopState = vi.fn();
const mockOnDesktopState = vi.fn();
const mockSetDesktopMode = vi.fn();
const mockGetVrmModels = vi.fn();

vi.mock("./desktopClient.js", () => ({
  getDesktopState: () => mockGetDesktopState(),
  onDesktopState: (cb: unknown) => mockOnDesktopState(cb),
  setDesktopMode: (...args: unknown[]) => mockSetDesktopMode(...args),
}));

vi.mock("../../api/avatar.js", () => ({
  getVrmModels: () => mockGetVrmModels(),
}));

function snapshot(patch: Partial<DesktopSnapshot> = {}): DesktopSnapshot {
  return {
    enabled: true,
    visible: false,
    ready: false,
    model: "a.vrm",
    revision: 1,
    generation: 1,
    error: null,
    ...patch,
  };
}

describe("DesktopModeButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAvatarPresentationStore.setState({ selectedModel: "" });
    mockGetDesktopState.mockResolvedValue(snapshot());
    mockOnDesktopState.mockResolvedValue(() => {});
    mockGetVrmModels.mockResolvedValue([]);
  });

  it("releases the event listener even when the subscription resolves after unmount", async () => {
    const unlisten = vi.fn();
    let resolveListen!: (fn: () => void) => void;
    mockOnDesktopState.mockReturnValue(new Promise<() => void>((resolve) => (resolveListen = resolve)));

    const { unmount } = render(<DesktopModeButton />);
    unmount();
    expect(unlisten).not.toHaveBeenCalled();
    resolveListen(unlisten);
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("tells the owner when the companion window never loaded", async () => {
    mockGetDesktopState.mockResolvedValue(snapshot({ error: "companion_load_failed" }));
    render(<DesktopModeButton />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/companion|acompañante/i);
  });

  it("tells the owner when the companion window could not be created", async () => {
    mockGetDesktopState.mockResolvedValue(snapshot({ error: "companion_build_failed" }));
    render(<DesktopModeButton />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/companion|acompañante/i);
  });

  it("auto-selects the bundled VRM when enabling with no selected model", async () => {
    mockGetDesktopState.mockResolvedValue(snapshot({ enabled: false, model: "" }));
    mockGetVrmModels.mockResolvedValue([
      { filename: "custom.vrm", size_mb: 12, modified_at: 100 },
      { filename: "kira_v3.vrm", size_mb: 18, modified_at: 200, bundled: true },
    ]);
    mockSetDesktopMode.mockResolvedValue(snapshot({ enabled: true, model: "kira_v3.vrm" }));

    render(<DesktopModeButton />);
    const button = await screen.findByRole("button");
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));

    fireEvent.click(button);

    await waitFor(() => expect(mockSetDesktopMode).toHaveBeenCalledWith(true, "kira_v3.vrm"));
    expect(useAvatarPresentationStore.getState().selectedModel).toBe("kira_v3.vrm");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to the first VRM when no bundled model is marked", async () => {
    mockGetDesktopState.mockResolvedValue(snapshot({ enabled: false, model: "" }));
    mockGetVrmModels.mockResolvedValue([
      { filename: "first.vrm", size_mb: 10, modified_at: 100 },
      { filename: "second.vrm", size_mb: 15, modified_at: 200 },
    ]);
    mockSetDesktopMode.mockResolvedValue(snapshot({ enabled: true, model: "first.vrm" }));

    render(<DesktopModeButton />);
    const button = await screen.findByRole("button");
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));

    fireEvent.click(button);

    await waitFor(() => expect(mockSetDesktopMode).toHaveBeenCalledWith(true, "first.vrm"));
    expect(useAvatarPresentationStore.getState().selectedModel).toBe("first.vrm");
  });

  it("shows the no-model error when the VRM list is empty", async () => {
    mockGetDesktopState.mockResolvedValue(snapshot({ enabled: false, model: "" }));
    mockGetVrmModels.mockResolvedValue([]);

    render(<DesktopModeButton />);
    const button = await screen.findByRole("button");
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));

    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mockSetDesktopMode).not.toHaveBeenCalled();
  });

  it("shows the no-model error when fetching the VRM list fails", async () => {
    mockGetDesktopState.mockResolvedValue(snapshot({ enabled: false, model: "" }));
    mockGetVrmModels.mockRejectedValue(new Error("network down"));

    render(<DesktopModeButton />);
    const button = await screen.findByRole("button");
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));

    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mockSetDesktopMode).not.toHaveBeenCalled();
  });
});
