import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRunGate, type FirstRunStatus } from "./FirstRunGate.js";
import { useUiLocaleStore } from "../../i18n/locale.js";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => mocks.open(...args) }));

const status = (overrides: Partial<FirstRunStatus> = {}): FirstRunStatus => ({
  phase: "unconfigured",
  launchable: false,
  data_root: null,
  default_data_root: "C:/Users/test/AppData/Local/OpenCohost/data",
  install_id: null,
  error_code: null,
  message: "Choose a local data folder",
  can_retry: true,
  progress: null,
  ...overrides
});

describe("FirstRunGate", () => {
  beforeEach(() => {
    useUiLocaleStore.getState().setLocale("es");
    mocks.invoke.mockReset();
    mocks.open.mockReset();
    mocks.open.mockResolvedValue("C:/Data/OpenCohost");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "first_run_status") return Promise.resolve(status());
      if (command === "provision_status") return Promise.resolve(status({ phase: "provisioning", message: "Downloading" }));
      return Promise.resolve(status({ phase: "provisioning", message: "Starting" }));
    });
  });

  it("renders unconfigured storage setup without mounting the product", async () => {
    render(<FirstRunGate onReady={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: /Prepare|Prepará/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose folder|Elegir carpeta/ })).toBeInTheDocument();
  });

  it("starts provisioning only after a native folder selection", async () => {
    render(<FirstRunGate onReady={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Choose folder|Elegir carpeta/ }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ directory: true })));
    expect(mocks.invoke).not.toHaveBeenCalledWith("provision_start", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: /Install core runtime|Instalar runtime core/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("provision_start", { dataRoot: "C:/Data/OpenCohost" }));
  });

  it("offers cancellation while provisioning and keeps diagnostics collapsed", async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === "first_run_status" ? status({ phase: "provisioning", message: "Downloading" }) : status({ phase: "provisioning", message: "Downloading" })));
    render(<FirstRunGate onReady={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Cancel installation|Cancelar instalación/ })).toBeInTheDocument();
    expect(screen.getByText(/Technical details|Detalles técnicos/).parentElement).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: /Cancel installation|Cancelar instalación/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("provision_cancel"));
  });

  it("notifies the backend gate only after a started operation reaches ready", async () => {
    const onReady = vi.fn();
    let running = true;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "first_run_status") return Promise.resolve(status({ phase: "ready", launchable: true, message: "Core runtime ready" }));
      if (command === "provision_start") { running = false; return Promise.resolve(status({ phase: "provisioning" })); }
      return Promise.resolve(running ? status({ phase: "provisioning" }) : status({ phase: "ready", launchable: true }));
    });
    render(<FirstRunGate onReady={onReady} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Core runtime ready|runtime/i));
    expect(onReady).not.toHaveBeenCalled();
  });

  it("keeps a post-provision launch failure in degraded recovery", async () => {
    const onReady = vi.fn();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "first_run_status") return Promise.resolve(status({ phase: "ready", launchable: true, message: "Core runtime ready" }));
      if (command === "reload_backend_command") return Promise.resolve({ managed: true });
      return Promise.resolve(status({ phase: "degraded", message: "backend launch failed", can_retry: true, error_code: "backend_launch_failed" }));
    });
    render(<FirstRunGate onReady={onReady} backendError="backend launch failed" />);
    expect(await screen.findByRole("button", { name: /Retry|Reintentar/ })).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Retry|Reintentar/ }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("reload_backend_command"));
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("does not render raw process or URL diagnostics", async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(
      command === "first_run_status"
        ? status({ phase: "failed", error_code: "process_failed", message: "TOKEN_CANARY C:/secret?token=leak", can_retry: true })
        : status({ phase: "failed", error_code: "process_failed", message: "TOKEN_CANARY C:/secret?token=leak", can_retry: true })
    ));
    render(<FirstRunGate onReady={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Retry|Reintentar/ })).toBeInTheDocument();
    expect(screen.queryByText(/TOKEN_CANARY|secret|token=leak/i)).not.toBeInTheDocument();
  });

  it("turns rejected start IPC into actionable recovery instead of stale busy state", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "first_run_status") return Promise.resolve(status());
      if (command === "provision_start") return Promise.reject(new Error("TOKEN_CANARY"));
      return Promise.resolve(status({ phase: "degraded", error_code: "ipc_unavailable" }));
    });
    render(<FirstRunGate onReady={vi.fn()} />);
    const install = await screen.findByRole("button", { name: /Install core runtime|Instalar runtime core/ });
    fireEvent.click(install);
    await waitFor(() => expect(screen.getByRole("button", { name: /Retry|Reintentar/ })).toBeInTheDocument());
    expect(screen.queryByText(/TOKEN_CANARY/)).not.toBeInTheDocument();
  });

  it("localizes the same safe cancellation code in Spanish and English", async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(
      command === "first_run_status"
        ? status({ phase: "failed", error_code: "cancelled" })
        : status({ phase: "failed", error_code: "cancelled" })
    ));
    render(<FirstRunGate onReady={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("La instalación fue cancelada");
    act(() => useUiLocaleStore.getState().setLocale("en"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Provisioning was cancelled"));
  });

  it("does not render unknown phase, progress, or error canaries in either locale", async () => {
    for (const locale of ["es", "en"] as const) {
      useUiLocaleStore.getState().setLocale(locale);
      mocks.invoke.mockImplementation((command: string) => Promise.resolve(
        command === "first_run_status"
          ? status({ phase: "failed", error_code: "TOKEN_ERROR_CANARY", progress: { phase: "C:/SECRET?token=1", completed: 1, total: 2, message: "RAW_CANARY" } })
          : status({ phase: "failed", error_code: "TOKEN_ERROR_CANARY" })
      ));
      const view = render(<FirstRunGate onReady={vi.fn()} />);
      expect(await screen.findByRole("button", { name: /Retry|Reintentar/ })).toBeInTheDocument();
      expect(view.container.textContent).not.toMatch(/TOKEN_ERROR_CANARY|SECRET|RAW_CANARY|C:\/SECRET|token=1/);
      view.unmount();
    }
  });

  it("keeps the operation active when cancellation is rejected as too late", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "first_run_status") return Promise.resolve(status({ phase: "provisioning" }));
      if (command === "provision_cancel") return Promise.reject("cancellation_too_late");
      return Promise.resolve(status({ phase: "ready", launchable: true }));
    });
    render(<FirstRunGate onReady={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Cancel installation|Cancelar instalación/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/listo|ready/i));
    expect(screen.queryByText(/cancelada|cancelled/i)).not.toBeInTheDocument();
  });
});
