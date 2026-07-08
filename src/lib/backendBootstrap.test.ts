import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

import { bootstrapBackend } from "./backendBootstrap.js";

/**
 * agent_context_gateway Phase 4 (ADR-5): the `api_token` Tauri command's
 * retry loop can take up to ~1.2s (or hang entirely on a broken IPC
 * boundary) before `bootstrapApiToken` resolves. `bootstrapBackend` awaits
 * it before first paint (main.tsx), so it must never block startup past the
 * same timeout budget already applied to `backend_info`.
 */
describe("bootstrapBackend / api_token timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    invokeMock.mockReset();
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("resolves within the bootstrap timeout even when the api_token invoke never settles", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockImplementation((command: string) => {
      if (command === "backend_info") {
        return Promise.resolve({ base_url: "http://127.0.0.1:8765", managed: true });
      }
      // api_token: never resolves — simulates a stuck/never-returning
      // main-thread retry (the exact scenario this fix guards against).
      return new Promise(() => {});
    });

    let settled = false;
    const donePromise = bootstrapBackend().then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2100);
    await donePromise;

    expect(settled).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("api_token");
  });
});
