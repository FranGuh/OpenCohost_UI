import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaneSwitcher } from "./PaneSwitcher.js";

const KEY = "oc-test-pane";
const OPTIONS = [
  { value: "one", label: "Uno" },
  { value: "two", label: "Dos" },
  { value: "three", label: "Tres" }
] as const;

beforeEach(() => {
  window.localStorage.clear();
});

function Host() {
  const { value, switcher } = usePaneSwitcher(OPTIONS, KEY, "Choose");
  return (
    <>
      {switcher}
      <p>selected: {value}</p>
    </>
  );
}

describe("usePaneSwitcher", () => {
  it("defaults to the first option when nothing is persisted", () => {
    const { result } = renderHook(() => usePaneSwitcher(OPTIONS, KEY, "Choose"));
    expect(result.current.value).toBe("one");
  });

  it("hydrates from a valid persisted value", () => {
    window.localStorage.setItem(KEY, "two");
    const { result } = renderHook(() => usePaneSwitcher(OPTIONS, KEY, "Choose"));
    expect(result.current.value).toBe("two");
  });

  it("ignores a corrupt/unknown persisted value and falls back to the first option, instead of rendering nothing", () => {
    window.localStorage.setItem(KEY, "not-a-real-option");
    render(<Host />);
    // Still a real, usable switcher — not a blank/broken render.
    expect(screen.getByRole("group", { name: "Choose" })).toBeInTheDocument();
    expect(screen.getByText("selected: one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uno" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the Segmented switcher with the resolved value pressed", () => {
    window.localStorage.setItem(KEY, "two");
    render(<Host />);
    expect(screen.getByRole("button", { name: "Uno" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Dos" })).toHaveAttribute("aria-pressed", "true");
  });

  it("updates the value and persists it to localStorage when the rendered control is clicked", () => {
    render(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "Tres" }));

    expect(screen.getByText("selected: three")).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBe("three");
  });

  it("wraps a blocked localStorage write in try/catch — selection still updates in memory", async () => {
    // Assigning `window.localStorage.setItem = fn` directly does NOT replace
    // the method in jsdom: Storage is a proxy that routes any string-property
    // assignment straight into a `setItem(prop, value)` call, so that used to
    // just create a "setItem" entry while the real native method kept
    // running — a vacuous guard. Storage.prototype.setItem must be spied on
    // instead to actually intercept the write.
    //
    // The error listener is the part that makes this test load-bearing. The
    // throw happens inside a React event handler, so React does not propagate
    // it out of fireEvent — it reports it asynchronously instead. Without
    // this, every synchronous assertion below still passes with the try/catch
    // deleted (the run only fails on an unhandled error, which is the suite
    // catching it by accident, not this test). Verified by hand: delete the
    // try/catch in usePaneSwitcher's select() and THIS test goes red.
    const onError = vi.fn();
    window.addEventListener("error", onError);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      render(<Host />);
      fireEvent.click(screen.getByRole("button", { name: "Dos" }));
      expect(screen.getByText("selected: two")).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 0)); // let React report a swallowed throw
      expect(onError).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      window.removeEventListener("error", onError);
    }
  });
});
