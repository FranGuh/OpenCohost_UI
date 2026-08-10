import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootCollage, BOOT_COLLAGE_ART } from "./BootCollage.js";

afterEach(() => vi.restoreAllMocks());

describe("BootCollage", () => {
  it("is a decorative, pointer-inert, aria-hidden layer", () => {
    const { container } = render(<BootCollage />);
    const layer = container.querySelector(".boot-collage");
    expect(layer).not.toBeNull();
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer?.className).toContain("pointer-events-none");
  });

  it("renders a shuffled, non-repeating slice of the eight known tiles", () => {
    // Math.random = 0.5 → count 5, deterministic Fisher-Yates.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { container } = render(<BootCollage />);
    const imgs = Array.from(container.querySelectorAll("img"));

    expect(imgs).toHaveLength(5);
    const srcs = imgs.map((img) => img.getAttribute("src"));
    for (const src of srcs) {
      expect(BOOT_COLLAGE_ART).toContain(src);
    }
    expect(new Set(srcs).size).toBe(srcs.length); // shuffle+slice never repeats
  });

  it("keeps the tile count inside the 4–6 range at both extremes", () => {
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0); // count 4
    const low = render(<BootCollage />);
    expect(low.container.querySelectorAll("img")).toHaveLength(4);
    low.unmount();

    rnd.mockReturnValue(0.999); // count 6
    const high = render(<BootCollage />);
    expect(high.container.querySelectorAll("img")).toHaveLength(6);
  });

  it("starts each tile invisible and fades it in only on its own load event", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { container } = render(<BootCollage />);
    const img = container.querySelector("img");
    if (!img) throw new Error("expected a collage tile");

    expect(img.className).toContain("opacity-0");
    expect(img.className).not.toContain("opacity-[0.35]");
    expect(img).toHaveAttribute("loading", "eager");

    fireEvent.load(img);

    expect(img.className).toContain("opacity-[0.35]");
    expect(img.className).not.toContain("opacity-0");
  });
});
