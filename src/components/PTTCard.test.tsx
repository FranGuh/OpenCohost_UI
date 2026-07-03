import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PTTCard } from "./PTTCard.js";

describe("PTTCard", () => {
  it("defaults to PTT off with the F10 keybind shown", () => {
    render(<PTTCard />);
    expect(screen.getByRole("switch", { name: "PTT" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("PTT off")).toBeInTheDocument();
    expect(screen.getByText("F10")).toBeInTheDocument();
  });

  it("toggles PTT on locally when the switch is clicked", () => {
    render(<PTTCard />);
    fireEvent.click(screen.getByRole("switch", { name: "PTT" }));
    expect(screen.getByRole("switch", { name: "PTT" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("PTT on")).toBeInTheDocument();
  });

  it("renders a Mapear button", () => {
    render(<PTTCard />);
    expect(screen.getByRole("button", { name: "Mapear" })).toBeInTheDocument();
  });

  it("shows a not-wired-yet note after clicking Mapear", () => {
    render(<PTTCard />);
    fireEvent.click(screen.getByRole("button", { name: "Mapear" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Mapear: se habilitará/);
  });
});
