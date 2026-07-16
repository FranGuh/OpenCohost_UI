import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAlertStyle, useAlertStyleStore } from "./useAlertStyle.js";

const STORAGE_KEY = "oc-alert-style";

// useAlertStyleStore is a module singleton by design (mirrors useTheme.ts's
// F4 fix — one shared source for every consumer). Each test re-derives it
// from localStorage instead of re-importing the module.
beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.alertStyle;
  useAlertStyleStore.getState()._hydrateForTests();
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.alertStyle;
});

describe("useAlertStyle", () => {
  it("defaults to sereno and applies data-alert-style to documentElement on mount", () => {
    renderHook(() => useAlertStyle());
    expect(document.documentElement.dataset.alertStyle).toBe("sereno");
  });

  it("setAlertStyle updates documentElement's data-alert-style and persists to localStorage", () => {
    const { result } = renderHook(() => useAlertStyle());

    act(() => result.current.setAlertStyle("marcado"));

    expect(result.current.alertStyle).toBe("marcado");
    expect(document.documentElement.dataset.alertStyle).toBe("marcado");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("marcado");
  });

  it("restores the previously saved style on load", () => {
    window.localStorage.setItem(STORAGE_KEY, "contorno");
    useAlertStyleStore.getState()._hydrateForTests();

    const { result } = renderHook(() => useAlertStyle());

    expect(result.current.alertStyle).toBe("contorno");
    expect(document.documentElement.dataset.alertStyle).toBe("contorno");
  });

  it("falls back to the default style when localStorage holds an unknown value", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-real-style");
    useAlertStyleStore.getState()._hydrateForTests();

    const { result } = renderHook(() => useAlertStyle());

    expect(result.current.alertStyle).toBe("sereno");
  });

  it("keeps multiple consumers in sync through the shared store", () => {
    const consumerA = renderHook(() => useAlertStyle());
    const consumerB = renderHook(() => useAlertStyle());

    act(() => consumerA.result.current.setAlertStyle("contorno"));

    expect(consumerA.result.current.alertStyle).toBe("contorno");
    expect(consumerB.result.current.alertStyle).toBe("contorno");
    expect(document.documentElement.dataset.alertStyle).toBe("contorno");
  });
});
