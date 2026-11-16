import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { SettingsPopover } from "./SettingsPopover.js";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function setTauri(on: boolean) {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useUiLocaleStore.setState({ locale: "es" });
  setTauri(true);
});

afterEach(() => {
  setTauri(false);
});

function openPanel() {
  render(<SettingsPopover onShowWelcome={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Configuración" }));
}

describe("SettingsPopover — Descargar modelos al cerrar", () => {
  it("renders ON by default with its help copy when the shell has no stored pref", async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "get_unload_models_on_exit" ? true : undefined)
    );
    openPanel();
    const sw = screen.getByRole("switch", { name: "Descargar modelos al cerrar" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Libera la memoria de la GPU al cerrar la app/)).toBeInTheDocument();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("get_unload_models_on_exit"));
  });

  it("reflects a stored OFF preference read from the shell", async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "get_unload_models_on_exit" ? false : undefined)
    );
    openPanel();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Descargar modelos al cerrar" })).toHaveAttribute(
        "aria-checked",
        "false"
      )
    );
  });

  it("toggling invokes set_unload_models_on_exit with the new value", async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "get_unload_models_on_exit" ? true : undefined)
    );
    openPanel();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("get_unload_models_on_exit"));
    const sw = screen.getByRole("switch", { name: "Descargar modelos al cerrar" });
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_unload_models_on_exit", { enabled: false })
    );
  });

  it("outside Tauri the switch still renders ON and never invokes", () => {
    setTauri(false);
    openPanel();
    const sw = screen.getByRole("switch", { name: "Descargar modelos al cerrar" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
