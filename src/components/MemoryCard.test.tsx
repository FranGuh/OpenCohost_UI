import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryCard } from "./MemoryCard.js";

describe("MemoryCard", () => {
  it("renders Limpiar memoria with its warning hint", () => {
    render(<MemoryCard />);
    expect(screen.getByRole("button", { name: "Limpiar memoria" })).toBeInTheDocument();
    expect(screen.getByText(/no se puede deshacer/)).toBeInTheDocument();
  });

  it("keeps Limpiar memoria permanently disabled with a not-wired status note — never a fake completion", () => {
    render(<MemoryCard />);
    const clearButton = screen.getByRole("button", { name: "Limpiar memoria" });
    expect(clearButton).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/endpoint de backend/);
    expect(screen.queryByText("aplicando…")).not.toBeInTheDocument();
  });

  it("renders the counts-only inspector with no raw chat content", () => {
    render(<MemoryCard />);
    expect(screen.getByText(/solo conteos/)).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
