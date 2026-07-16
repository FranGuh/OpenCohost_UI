import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Module-scope spies referenced lazily inside the mock factory (matching the
// repo's @tauri-apps/api/core mock convention) — the closure only reads them at
// click time, so there is no temporal-dead-zone issue with vi.mock hoisting.
const minimize = vi.fn().mockResolvedValue(undefined);
const toggleMaximize = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close })
}));

import { TitleBar } from "./TitleBar.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("TitleBar", () => {
  it("renders the brand lockup and three window controls", () => {
    render(<TitleBar />);
    expect(screen.getByText("OpenCohost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimizar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximizar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("drives the Tauri window API from each caption button", async () => {
    render(<TitleBar />);

    // Each handler dynamically import()s the mocked module and fires-and-forgets;
    // await each spy before the next click so the import settles deterministically.
    fireEvent.click(screen.getByRole("button", { name: "Minimizar" }));
    await waitFor(() => expect(minimize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Maximizar" }));
    await waitFor(() => expect(toggleMaximize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
});
