import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCollapsible } from "./Collapsible.js";

const KEY = "oc-collapse-test-section";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useCollapsible", () => {
  it("defaults to open (true) and toggles in memory, never touching localStorage without a persistKey", () => {
    const { result } = renderHook(() => useCollapsible());
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());

    expect(result.current[0]).toBe(false);
    // No persistKey -> no key written anywhere.
    expect(window.localStorage.length).toBe(0);
  });

  it("honours an explicit defaultOpen=false with no persistKey", () => {
    const { result } = renderHook(() => useCollapsible(false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it("hydrates the initial state from localStorage when a persistKey is set", () => {
    window.localStorage.setItem(KEY, "0");
    const { result } = renderHook(() => useCollapsible(true, "test-section"));
    // Stored "0" wins over defaultOpen=true.
    expect(result.current[0]).toBe(false);

    window.localStorage.setItem(KEY, "1");
    const second = renderHook(() => useCollapsible(false, "test-section"));
    // Stored "1" wins over defaultOpen=false.
    expect(second.result.current[0]).toBe(true);
  });

  it("falls back to defaultOpen when the persistKey has no stored value yet", () => {
    const open = renderHook(() => useCollapsible(true, "test-section"));
    expect(open.result.current[0]).toBe(true);

    window.localStorage.clear();
    const closed = renderHook(() => useCollapsible(false, "test-section"));
    expect(closed.result.current[0]).toBe(false);
  });

  it("writes the new state through to localStorage on every toggle when a persistKey is set", () => {
    const { result } = renderHook(() => useCollapsible(true, "test-section"));

    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe("0");

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");
  });
});
