import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "./Input.js";
import { Textarea } from "./Textarea.js";

function mockScrollHeight(value: number) {
  return vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(value);
}

describe("Textarea", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders a single-row textarea", () => {
    render(<Textarea aria-label="msg" />);
    const el = screen.getByLabelText("msg");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el).toHaveAttribute("rows", "1");
  });

  it("shares the Input look: border, radius, colors, padding, focus ring and the h-11 single-line floor", () => {
    render(
      <>
        <Input aria-label="i" />
        <Textarea aria-label="t" />
      </>
    );
    const input = screen.getByLabelText("i");
    const area = screen.getByLabelText("t");
    for (const token of [
      "rounded-md",
      "border",
      "border-[var(--border)]",
      "bg-[var(--background)]",
      "px-3",
      "text-sm",
      "text-[var(--foreground)]",
      "focus-visible:outline-[var(--ring)]"
    ]) {
      expect(input.className).toContain(token);
      expect(area.className).toContain(token);
    }
    expect(area.className).toContain("min-h-11");
    expect(area.className).toContain("resize-none");
  });

  it("grows to its content height and resets when the value is cleared", () => {
    const spy = mockScrollHeight(100);
    const { rerender } = render(<Textarea aria-label="msg" value={"a\nb\nc"} onChange={() => {}} />);
    const el = screen.getByLabelText("msg") as HTMLTextAreaElement;
    expect(el.style.height).toBe("100px");

    spy.mockReturnValue(44);
    rerender(<Textarea aria-label="msg" value="" onChange={() => {}} />);
    expect(el.style.height).toBe("44px");
  });

  it("caps growth at about 6 lines and scrolls inside", () => {
    render(<Textarea aria-label="msg" />);
    const el = screen.getByLabelText("msg");
    expect(el.className).toContain("max-h-36");
    expect(el.className).toContain("overflow-y-auto");
  });

  it("with a trailing slot wraps the field like Input does", () => {
    const { container } = render(<Textarea aria-label="msg" trailing={<button type="button">go</button>} />);
    expect(screen.getByLabelText("msg").className).toContain("rounded-r-none");
    expect(container.firstElementChild?.className).toContain("focus-within:outline");
    expect(screen.getByRole("button", { name: "go" })).toBeInTheDocument();
  });
});
