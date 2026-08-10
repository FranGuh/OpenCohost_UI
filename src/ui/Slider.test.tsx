import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Slider } from "./Slider.js";

describe("Slider", () => {
  it("renders an accessible range input reflecting the value prop", () => {
    render(<Slider value={42} onChange={() => undefined} aria-label="Volumen" />);
    const el = screen.getByRole("slider", { name: "Volumen" });
    expect(el).toHaveValue("42");
  });

  it("calls onChange with the numeric value on change", () => {
    const onChange = vi.fn();
    render(<Slider value={0} onChange={onChange} aria-label="Volumen" />);
    fireEvent.change(screen.getByRole("slider", { name: "Volumen" }), { target: { value: "55" } });
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it("defaults to a 0-100 range with step 1, and respects custom bounds", () => {
    const { rerender } = render(<Slider value={10} onChange={() => undefined} aria-label="Volumen" />);
    const el = screen.getByRole("slider", { name: "Volumen" });
    expect(el).toHaveAttribute("min", "0");
    expect(el).toHaveAttribute("max", "100");
    expect(el).toHaveAttribute("step", "1");

    rerender(<Slider value={10} onChange={() => undefined} min={1} max={10} step={0.5} aria-label="Volumen" />);
    expect(el).toHaveAttribute("min", "1");
    expect(el).toHaveAttribute("max", "10");
    expect(el).toHaveAttribute("step", "0.5");
  });

  it("disables the control and blocks onChange when disabled is true", () => {
    const onChange = vi.fn();
    render(<Slider value={10} onChange={onChange} disabled aria-label="Volumen" />);
    const el = screen.getByRole("slider", { name: "Volumen" });
    expect(el).toBeDisabled();
  });
});
