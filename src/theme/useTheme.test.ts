import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme.js";

const STORAGE_KEY = "oc-theme";

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
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

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("studio");
    expect(document.documentElement.dataset.theme).toBe("studio");
  });

  it("falls back to the default theme when localStorage holds an unknown value", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-real-theme");

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe("cockpit");
  });
});
