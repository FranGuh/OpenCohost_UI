import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select.js";

describe("Select", () => {
  it("renders its option children", () => {
    render(
      <Select aria-label="Test select" value="a" onChange={() => undefined}>
        <option value="a">Opción A</option>
        <option value="b">Opción B</option>
      </Select>
    );
    expect(screen.getByRole("option", { name: "Opción A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Opción B" })).toBeInTheDocument();
  });

  it("fires onChange with the selected value", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Test select" value="a" onChange={onChange}>
        <option value="a">Opción A</option>
        <option value="b">Opción B</option>
      </Select>
    );
    fireEvent.change(screen.getByLabelText("Test select"), { target: { value: "b" } });
    expect(onChange).toHaveBeenCalled();
  });
});
