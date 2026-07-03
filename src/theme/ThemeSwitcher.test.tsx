import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeSwitcher } from "./ThemeSwitcher.js";

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("ThemeSwitcher", () => {
  it("renders the 3 themes as a segmented control, cockpit pressed by default", () => {
    render(<ThemeSwitcher />);

    expect(screen.getByRole("button", { name: "Cockpit" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Aurora" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Studio" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switching to Aurora updates data-theme live and persists it", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole("button", { name: "Aurora" }));

    expect(screen.getByRole("button", { name: "Aurora" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Cockpit" })).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.theme).toBe("aurora");
    expect(window.localStorage.getItem("oc-theme")).toBe("aurora");
  });
});
