import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select.js";

// The native <select> children variant (backward-compat escape hatch) was
// removed — Select now only renders the custom dropdown. See Select.tsx's
// docstring for why.

const OPTS = [
  { value: "a", label: "Opción A" },
  { value: "b", label: "Opción B" }
] as const;

describe("Select (custom)", () => {
  it("renders the selected label in the trigger", () => {
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    expect(screen.getByRole("combobox", { name: "Test select" })).toHaveTextContent("Opción A");
  });

  it("opens the listbox on click and shows all options", () => {
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Opción A/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Opción B/ })).toBeInTheDocument();
  });

  it("fires onChange with the value string when an option is clicked", () => {
    const onChange = vi.fn();
    render(<Select options={OPTS} value="a" onChange={onChange} aria-label="Test select" />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Opción B/ }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("closes the listbox after selecting an option", () => {
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Opción B/ }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

// jsdom reports zero for all real layout geometry, so these can't assert real
// on-screen positioning — same limitation as Sidebar.test.tsx's tooltip-clamp
// tests. What IS real: stubbing getBoundingClientRect/innerHeight and reading
// back the resulting inline style proves the max-height comes from that
// measured space (not a hardcoded constant), and that the list carries the
// overflow/scroll affordance.
describe("Select (custom) — dropdown sizing", () => {
  it("caps the list height to the measured space below the trigger, not a hardcoded constant", () => {
    const originalInnerHeight = window.innerHeight;
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    const button = screen.getByRole("combobox");
    const trigger = button.parentElement as HTMLElement;
    try {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
      trigger.getBoundingClientRect = () =>
        ({ top: 10, bottom: 40, left: 0, right: 100, width: 100, height: 30, x: 0, y: 10, toJSON() {} }) as DOMRect;

      fireEvent.click(button);

      const list = screen.getByRole("listbox");
      expect(list).toHaveClass("overflow-y-auto");
      // spaceBelow = innerHeight(200) - rect.bottom(40) - gap(4) = 156, well under
      // the 384px ceiling — a hardcoded ceiling would show 384 here instead.
      expect(list).toHaveStyle({ top: "44px", maxHeight: "156px" });
      expect(list.style.bottom).toBe("");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });

  it("opens upward when there is more room above the trigger than below", () => {
    const originalInnerHeight = window.innerHeight;
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    const button = screen.getByRole("combobox");
    const trigger = button.parentElement as HTMLElement;
    try {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
      trigger.getBoundingClientRect = () =>
        ({ top: 300, bottom: 790, left: 0, right: 100, width: 100, height: 490, x: 0, y: 300, toJSON() {} }) as DOMRect;

      fireEvent.click(button);

      const list = screen.getByRole("listbox");
      // spaceBelow = 800 - 790 - 4 = 6; spaceAbove = 300 - 4 = 296 → flips upward.
      expect(list).toHaveStyle({ bottom: "504px", maxHeight: "296px" });
      expect(list.style.top).toBe("");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });
});
