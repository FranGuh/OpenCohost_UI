import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryCard } from "./MemoryCard.js";

describe("MemoryCard", () => {
  it("renders Limpiar memoria with its warning hint", () => {
    render(<MemoryCard />);
    expect(screen.getByRole("button", { name: "Limpiar memoria" })).toBeInTheDocument();
    expect(screen.getByText(/no se puede deshacer/)).toBeInTheDocument();
  });

  it("renders the editorial cards and memory accent buttons", () => {
    render(<MemoryCard />);
    expect(screen.getByRole("button", { name: "Tarjetas editoriales · 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Memoria de Kira" })).toBeInTheDocument();
  });

  it("shows a not-wired-yet note after clicking Limpiar memoria", () => {
    render(<MemoryCard />);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar memoria" }));
    expect(screen.getByRole("status")).toHaveTextContent(/Limpiar memoria: se habilitará/);
  });
});
