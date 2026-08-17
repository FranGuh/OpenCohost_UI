import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  setApiBaseUrl: vi.fn(),
  bootstrapApiToken: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args)
}));

vi.mock("../api/client.js", () => ({
  bootstrapApiToken: () => mocks.bootstrapApiToken(),
  getApiBaseUrl: () => "http://127.0.0.1:8765",
  setApiBaseUrl: (url: string) => mocks.setApiBaseUrl(url)
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function loadBootstrap() {
  vi.resetModules();
  return import("./backendBootstrap.js");
}

async function flushBootstrapStart() {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

describe("bootstrapBackend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.invoke.mockReset();
    mocks.setApiBaseUrl.mockReset();
    mocks.bootstrapApiToken.mockReset();
    mocks.bootstrapApiToken.mockImplementation(() => mocks.invoke("api_token"));
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("starts backend_info and api_token concurrently", async () => {
    const backendInfo = deferred<{ base_url: string; managed: boolean }>();
    const apiToken = deferred<null>();
    mocks.invoke.mockImplementation((command: string) =>
      command === "backend_info" ? backendInfo.promise : apiToken.promise
    );
    const { bootstrapBackend } = await loadBootstrap();

    const resultPromise = bootstrapBackend();
    await flushBootstrapStart();

    expect(mocks.invoke).toHaveBeenCalledWith("backend_info");
    expect(mocks.invoke).toHaveBeenCalledWith("api_token");

    backendInfo.resolve({ base_url: "http://127.0.0.1:8765", managed: true });
    apiToken.resolve(null);
    await expect(resultPromise).resolves.toEqual({ backendError: null });
  });

  it("settles both stuck IPC operations within one shared two-second deadline", async () => {
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    const { bootstrapBackend } = await loadBootstrap();
    let result: { backendError: string | null } | undefined;
    let settledAt: number | undefined;
    const startedAt = Date.now();

    void bootstrapBackend().then((value) => {
      result = value;
      settledAt = Date.now();
    });
    await flushBootstrapStart();

    await vi.advanceTimersByTimeAsync(1999);
    expect(result).toBeUndefined();
    expect(settledAt).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);

    expect(result).toEqual({ backendError: "ipc_unavailable" });
    expect(settledAt).toBeGreaterThanOrEqual(startedAt + 2000);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("shares one IPC bootstrap across a real React StrictMode remount and reaches ready", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "backend_info"
          ? { base_url: "http://127.0.0.1:8765", managed: true }
          : null
      )
    );
    await loadBootstrap();
    const { BackendGate } = await import("../features/shell/BackendGate.js");
    vi.useRealTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ engine_alive: true })
    } as Response);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(BackendGate, {
            pollIntervalMs: 5,
            failureThreshold: 1,
            children: React.createElement("main", null, "application shell")
          })
        )
      )
    );
    expect(screen.getByRole("status")).toHaveTextContent("Preparando motor local");
    expect(await screen.findByText("application shell")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("backend_info");
    expect(mocks.invoke).toHaveBeenCalledWith("api_token");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("returns one shared promise and invokes each command once for concurrent callers", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "backend_info"
          ? { base_url: "http://127.0.0.1:8765", managed: true }
          : null
      )
    );
    const { bootstrapBackend } = await loadBootstrap();

    const first = bootstrapBackend();
    const second = bootstrapBackend();

    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ backendError: null });
    expect(mocks.invoke).toHaveBeenCalledWith("backend_info");
    expect(mocks.invoke).toHaveBeenCalledWith("api_token");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("applies a valid backend URL and preserves Rust degraded detail", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "backend_info"
          ? {
              base_url: "http://127.0.0.1:9876",
              managed: false,
              error: {
                code: "backend_launch_failed",
                stage: "launch",
                action: "retry",
                message_key: "backend_launch_failed"
              }
            }
          : null
      )
    );
    const { bootstrapBackend, getBackendBootstrapError } = await loadBootstrap();

    await expect(bootstrapBackend()).resolves.toEqual({
      backendError: "backend_launch_failed"
    });
    expect(mocks.setApiBaseUrl).toHaveBeenCalledWith("http://127.0.0.1:9876");
    expect(getBackendBootstrapError()).toBe(
      "backend_launch_failed"
    );
  });

  it("keeps the configured default when backend_info returns an invalid URL", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "backend_info"
          ? { base_url: "not a URL", managed: true }
          : null
      )
    );
    const { bootstrapBackend } = await loadBootstrap();

    await expect(bootstrapBackend()).resolves.toEqual({
      backendError: "ipc_unavailable"
    });
    expect(mocks.setApiBaseUrl).not.toHaveBeenCalled();
  });

  it("maps an unknown diagnostic envelope to a safe stable code", async () => {
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "backend_info"
          ? {
              base_url: "http://127.0.0.1:8765",
              managed: false,
              error: {
                code: "SECRET_CANARY C:/private?token=leak",
                stage: "C:/private",
                action: "--token=leak",
                message_key: "raw-error"
              }
            }
          : null
      )
    );
    const { bootstrapBackend } = await loadBootstrap();
    await expect(bootstrapBackend()).resolves.toEqual({ backendError: "generic", runtimeRequired: true });
  });
});
