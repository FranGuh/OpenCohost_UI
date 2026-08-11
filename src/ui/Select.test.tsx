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

// The list closes on scroll because a portaled element does not follow its
// trigger. But the list scrolls INTERNALLY too (max-height + overflow-y-auto)
// and centres the selected option when it opens, and both emit scroll events
// that a capture listener on window catches. Without a target guard the
// feature eats itself, and neither existing test could see it: scrolling was
// untested and scrollIntoView is stubbed to a no-op in src/test/setup.ts.
describe("Select (custom) — scrolling inside the list must not close it", () => {
  it("stays open when the scroll originates inside the listbox", () => {
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    fireEvent.click(screen.getByRole("combobox"));
    const listbox = screen.getByRole("listbox");

    fireEvent.scroll(listbox);

    expect(screen.queryByRole("listbox")).toBeInTheDocument();
  });

  it("still closes when the scroll originates anywhere else", () => {
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // A real ancestor scroll container moving under the open list — the case
    // the close-on-scroll behaviour exists for.
    fireEvent.scroll(document.body);

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

  it("floors the list height when both sides are too cramped, even if that overlaps the trigger (owner's 35px/30px example)", () => {
    const originalInnerHeight = window.innerHeight;
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    const button = screen.getByRole("combobox");
    const trigger = button.parentElement as HTMLElement;
    try {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
      // spaceAbove = 35, spaceBelow = 30 — the formula would open a 35px list.
      trigger.getBoundingClientRect = () =>
        ({ top: 39, bottom: 766, left: 0, right: 100, width: 100, height: 727, x: 0, y: 39, toJSON() {} }) as DOMRect;

      fireEvent.click(button);

      const list = screen.getByRole("listbox");
      // Larger side (above, 35) still loses to the 120px floor. Direction stays
      // "toward the larger side" (upward), but pinned with `top` and clamped to
      // the viewport (top can't go negative), so it overlaps the trigger.
      expect(list).toHaveStyle({ top: "4px", maxHeight: "120px" });
      expect(list.style.bottom).toBe("");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });

  it("clamps the floored height to the viewport when the trigger sits dead-centre in a very short viewport", () => {
    const originalInnerHeight = window.innerHeight;
    render(<Select options={OPTS} value="a" onChange={() => undefined} aria-label="Test select" />);
    const button = screen.getByRole("combobox");
    const trigger = button.parentElement as HTMLElement;
    try {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
      // Dead-centre: spaceAbove = 41, spaceBelow = 41 — under the 120px floor,
      // and the viewport itself (100px) can't fit the floor either.
      trigger.getBoundingClientRect = () =>
        ({ top: 45, bottom: 55, left: 0, right: 100, width: 100, height: 10, x: 0, y: 45, toJSON() {} }) as DOMRect;

      fireEvent.click(button);

      const list = screen.getByRole("listbox");
      // viewportRoom = 100 - 2*4 = 92, below the 120px floor, so maxHeight clamps
      // to 92 and top pins to the GAP (4px) — the list nearly fills the viewport
      // top-to-bottom, fully overlapping the trigger, and never goes off-screen.
      expect(list).toHaveStyle({ top: "4px", maxHeight: "92px" });
      expect(list.style.bottom).toBe("");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });
});

// scrollIntoView is stubbed globally in src/test/setup.ts (jsdom has no
// implementation at all), so these override it per-test to make it a spy.
describe("Select (custom) — scrolls the selected option into view on open", () => {
  it("centers the selected option once the list mounts with its measured size", () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const manyOptions = Array.from({ length: 20 }, (_, i) => ({ value: String(i), label: `Opción ${i}` }));
    try {
      render(<Select options={manyOptions} value="17" onChange={() => undefined} aria-label="Test select" />);

      fireEvent.click(screen.getByRole("combobox"));

      const selectedOption = screen.getByRole("option", { name: "Opción 17" });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      // Called on the selected option itself, not some other row.
      expect(scrollIntoView.mock.instances[0]).toBe(selectedOption);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("does not throw when nothing matches the current value (no selected option to scroll to)", () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<Select options={OPTS} value="not-a-real-value" onChange={() => undefined} aria-label="Test select" />);

      fireEvent.click(screen.getByRole("combobox"));

      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
