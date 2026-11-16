import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "./openUrl.js";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args)
}));

describe("openExternalUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("calls native invoke when running inside Tauri", async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockResolvedValueOnce(undefined);

    const result = await openExternalUrl("https://www.tavily.com/?utm_source=opencohost");
    expect(result).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("open_external_url", {
      url: "https://www.tavily.com/?utm_source=opencohost"
    });
  });

  it("falls back to window.open when outside Tauri", async () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const result = await openExternalUrl("https://www.tavily.com/?utm_source=opencohost");
    expect(result).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(windowOpenSpy).toHaveBeenCalledWith("https://www.tavily.com/?utm_source=opencohost", "_blank", "noreferrer");
  });

  it("falls back to window.open when native invoke throws", async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    mocks.invoke.mockRejectedValueOnce(new Error("IPC failed"));
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const result = await openExternalUrl("https://www.tavily.com/?utm_source=opencohost");
    expect(result).toBe(true);
    expect(mocks.invoke).toHaveBeenCalled();
    expect(windowOpenSpy).toHaveBeenCalledWith("https://www.tavily.com/?utm_source=opencohost", "_blank", "noreferrer");
  });
});
