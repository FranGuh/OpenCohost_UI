import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTheme, useThemeStore } from "./useTheme.js";

const STORAGE_KEY = "oc-theme";

// useThemeStore (F4) is a module singleton by design (one shared source for
// every consumer). Each test re-derives it from localStorage instead of
// re-importing the module.
beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  useThemeStore.getState()._hydrateForTests();
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("useTheme", () => {
  it("defaults to cockpit and applies data-theme to documentElement on mount", () => {
    renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe("cockpit");
  });

  it("setTheme updates documentElement's data-theme and persists to localStorage", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("aurora"));

    expect(result.current.theme).toBe("aurora");
    expect(document.documentElement.dataset.theme).toBe("aurora");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("aurora");
  });

  it("restores the previously saved theme on load", () => {
    window.localStorage.setItem(STORAGE_KEY, "studio");
    useThemeStore.getState()._hydrateForTests();

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("studio");
    expect(document.documentElement.dataset.theme).toBe("studio");
  });

  it("falls back to the default theme when localStorage holds an unknown value", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-real-theme");
    useThemeStore.getState()._hydrateForTests();

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("cockpit");
  });

  // F4 regression: two components consuming useTheme must share ONE theme
  // value instead of desyncing per-component state.
  it("keeps multiple consumers in sync through the shared store", () => {
    const consumerA = renderHook(() => useTheme());
    const consumerB = renderHook(() => useTheme());

    act(() => consumerA.result.current.setTheme("aurora"));

    expect(consumerA.result.current.theme).toBe("aurora");
    expect(consumerB.result.current.theme).toBe("aurora");
    expect(document.documentElement.dataset.theme).toBe("aurora");
  });
});
