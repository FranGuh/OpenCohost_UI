import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandMark } from "./BrandMark.js";

describe("BrandMark", () => {
  it("renders an accessible svg logo", () => {
    render(<BrandMark />);
    const svg = screen.getByRole("img", { name: "OpenCohost" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });
});
