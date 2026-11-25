import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VrmModelPicker } from "./VrmModelPicker.js";

const MODELS = [
  { filename: "Kira v3.vrm", size_mb: 20, modified_at: 1, bundled: true },
  { filename: "mine.vrm", size_mb: 5, modified_at: 2, bundled: false },
  { filename: "other.vrm", size_mb: 7, modified_at: 3, bundled: false }
];

function setup(props: Partial<React.ComponentProps<typeof VrmModelPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <VrmModelPicker
      models={MODELS}
      value="mine.vrm"
      onChange={onChange}
      ariaLabel="Modelo VRM activo"
      bundledLabel="incluido"
      {...props}
    />
  );
  return onChange;
}

describe("VrmModelPicker", () => {
  it("renders a radiogroup with one radio per model and marks the selected one", () => {
    setup();
    expect(screen.getByRole("radiogroup", { name: "Modelo VRM activo" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /mine/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /other/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("incluido")).toBeInTheDocument();
    expect(screen.getByText("Kira v3")).toBeInTheDocument();
  });

  it("uses a roving tabindex", () => {
    setup();
    expect(screen.getByRole("radio", { name: /mine/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /other/ })).toHaveAttribute("tabindex", "-1");
  });

  it("click selects by filename", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("radio", { name: /other/ }));
    expect(onChange).toHaveBeenCalledWith("other.vrm");
  });

  it("arrow keys, Home and End move and select", () => {
    const onChange = setup();
    const current = screen.getByRole("radio", { name: /mine/ });
    fireEvent.keyDown(current, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("other.vrm");
    fireEvent.keyDown(current, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("Kira v3.vrm");
    fireEvent.keyDown(current, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("Kira v3.vrm");
    fireEvent.keyDown(current, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("other.vrm");
  });

  it("is inert when disabled", () => {
    const onChange = setup({ disabled: true });
    const radio = screen.getByRole("radio", { name: /other/ });
    expect(radio).toBeDisabled();
    fireEvent.click(radio);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a fallback icon when the thumbnail fails to load", () => {
    setup();
    const imgs = document.querySelectorAll("img");
    expect(imgs.length).toBe(3);
    expect(imgs[0].getAttribute("src")).toContain("/api/avatar/vrm/thumbnail?name=Kira%20v3.vrm");
    fireEvent.error(imgs[0]);
    expect(document.querySelectorAll("img").length).toBe(2);
    expect(screen.getByRole("radio", { name: /Kira v3/ }).querySelector("svg")).not.toBeNull();
  });
});
