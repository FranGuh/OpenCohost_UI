import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BootLoader } from "./BootLoader.js";

describe("BootLoader", () => {
  it("exposes an accessible polite status carrying the live phase label", () => {
    render(<BootLoader statusLabel="Preparando motor local…" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Preparando motor local");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-busy", "true");
  });

  it("renders the breathing brand mark (BrandMark svg, aria-hidden)", () => {
    const { container } = render(<BootLoader statusLabel="Comprobando motor local…" />);

    // The looping breathing hook the styles.css keyframe targets.
    expect(container.querySelector(".boot-mark")).not.toBeNull();
    // The brand mark itself is present but hidden from the a11y tree (the
    // status label already names the state), so it isn't announced twice.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
