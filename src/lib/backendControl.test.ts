import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBackendStatus, reloadBackend, type BackendStatus } from "./backendControl.js";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mocks.invoke(...args) }));

const STATUS: BackendStatus = {
  managed: true,
  child_alive: true,
  restarting: false,
  gave_up: false,
  restarts: 0,
  error_code: null,
  log_path: "C:/data/logs/backend.log",
  last_line: "INFO started"
};

function setTauri(on: boolean) {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

describe("backendControl", () => {
  beforeEach(() => mocks.invoke.mockReset());
  afterEach(() => setTauri(false));

  it("reports no status and an unavailable reload outside Tauri without touching IPC", async () => {
    setTauri(false);
    expect(await getBackendStatus()).toBeNull();
    expect(await reloadBackend()).toEqual({ ok: false, unavailable: true });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reads the supervisor status over IPC", async () => {
    setTauri(true);
    mocks.invoke.mockResolvedValue(STATUS);
    expect(await getBackendStatus()).toEqual(STATUS);
    expect(mocks.invoke).toHaveBeenCalledWith("backend_status");
  });

  it("treats a failing status call as no status", async () => {
    setTauri(true);
    mocks.invoke.mockRejectedValueOnce("boom");
    expect(await getBackendStatus()).toBeNull();
  });

  it("calls reload_backend_command and reports success", async () => {
    setTauri(true);
    mocks.invoke.mockResolvedValue({ managed: true });
    expect(await reloadBackend()).toEqual({ ok: true });
    expect(mocks.invoke).toHaveBeenCalledWith("reload_backend_command");
  });

  it("passes the real error code through on a failed reload and drops unsafe text", async () => {
    setTauri(true);
    mocks.invoke.mockRejectedValueOnce("backend_ports_busy");
    expect(await reloadBackend()).toEqual({ ok: false, code: "backend_ports_busy" });
    mocks.invoke.mockRejectedValueOnce("C:/secret/path TOKEN_CANARY");
    expect(await reloadBackend()).toEqual({ ok: false, code: null });
    mocks.invoke.mockRejectedValueOnce(new Error("x"));
    expect(await reloadBackend()).toEqual({ ok: false, code: null });
  });
});
