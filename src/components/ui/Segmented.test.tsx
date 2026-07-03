import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Segmented } from "./Segmented.js";

const OPTIONS = [
  { value: "a", label: "Opción A" },
  { value: "b", label: "Opción B" }
] as const;

describe("Segmented", () => {
  it("marks the active option as pressed", () => {
    render(<Segmented options={OPTIONS} value="a" onChange={() => undefined} ariaLabel="Test" />);
    expect(screen.getByRole("button", { name: "Opción A" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Opción B" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange with the clicked option's value", () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value="a" onChange={onChange} ariaLabel="Test" />);
    fireEvent.click(screen.getByRole("button", { name: "Opción B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("disables every option and blocks onChange when disabled is true", () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value="a" onChange={onChange} ariaLabel="Test" disabled />);
    const optionB = screen.getByRole("button", { name: "Opción B" });
    expect(optionB).toBeDisabled();
    fireEvent.click(optionB);
    expect(onChange).not.toHaveBeenCalled();
  });
});
