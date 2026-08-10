import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch.js";

describe("Switch", () => {
  it("renders an accessible switch reflecting the checked prop", () => {
    render(<Switch checked={false} onChange={() => undefined} aria-label="PTT" />);
    const el = screen.getByRole("switch", { name: "PTT" });
    expect(el).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the toggled value on click", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="PTT" />);
    fireEvent.click(screen.getByRole("switch", { name: "PTT" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflects checked=true visually via aria-checked", () => {
    render(<Switch checked={true} onChange={() => undefined} aria-label="PTT" />);
    expect(screen.getByRole("switch", { name: "PTT" })).toHaveAttribute("aria-checked", "true");
  });

  it("disables the control and blocks onChange when disabled is true", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} disabled aria-label="PTT" />);
    const el = screen.getByRole("switch", { name: "PTT" });
    expect(el).toBeDisabled();
    fireEvent.click(el);
    expect(onChange).not.toHaveBeenCalled();
  });
});
