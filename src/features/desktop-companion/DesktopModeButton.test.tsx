import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopModeButton } from "./DesktopModeButton.js";
import type { DesktopSnapshot } from "./desktopClient.js";

const mockGetDesktopState = vi.fn();
const mockOnDesktopState = vi.fn();
const mockSetDesktopMode = vi.fn();

vi.mock("./desktopClient.js", () => ({
  getDesktopState: () => mockGetDesktopState(),
  onDesktopState: (cb: unknown) => mockOnDesktopState(cb),
  setDesktopMode: (...args: unknown[]) => mockSetDesktopMode(...args),
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
    mockGetDesktopState.mockResolvedValue(snapshot());
    mockOnDesktopState.mockResolvedValue(() => {});
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
});
