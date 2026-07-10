import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "oc-welcome-dismissed-v1";

async function loadStore() {
  return import("./welcomeStore.js");
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.resetModules();
});

describe("welcomeStore", () => {
  it("shows the Welcome card on a first visit", async () => {
    const { useWelcomeStore } = await loadStore();

    expect(useWelcomeStore.getState().dismissed).toBe(false);
  });

  it("persists dismissal and restores it in a fresh module instance", async () => {
    const firstLoad = await loadStore();
    firstLoad.useWelcomeStore.getState().dismiss();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

    vi.resetModules();
    const reloaded = await loadStore();
    expect(reloaded.useWelcomeStore.getState().dismissed).toBe(true);
  });

  it("restores Welcome visibility and persists the restored preference", async () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    const { useWelcomeStore } = await loadStore();

    useWelcomeStore.getState().restore();

    expect(useWelcomeStore.getState().dismissed).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("exports one module-singleton store shared by every importer", async () => {
    const firstImport = await loadStore();
    const secondImport = await loadStore();

    firstImport.useWelcomeStore.getState().dismiss();

    expect(secondImport.useWelcomeStore).toBe(firstImport.useWelcomeStore);
    expect(secondImport.useWelcomeStore.getState().dismissed).toBe(true);
  });

  it("fails safe to visible when reading localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    const { useWelcomeStore } = await loadStore();

    expect(useWelcomeStore.getState().dismissed).toBe(false);
  });

  it("keeps dismiss and restore working in memory when writes throw", async () => {
    const { useWelcomeStore } = await loadStore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    useWelcomeStore.getState().dismiss();
    expect(useWelcomeStore.getState().dismissed).toBe(true);

    useWelcomeStore.getState().restore();
    expect(useWelcomeStore.getState().dismissed).toBe(false);
  });
});
