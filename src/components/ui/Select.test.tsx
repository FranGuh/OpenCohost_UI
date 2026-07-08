import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select.js";

// ─── Native variant (children API) — backward compat ──────────────────────

describe("Select (native)", () => {
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

// ─── Custom variant (options API) ─────────────────────────────────────────

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
