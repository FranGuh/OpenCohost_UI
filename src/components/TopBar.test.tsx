import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TopBar } from "./TopBar.js";

vi.mock("./StatusRail.js", () => ({ StatusRail: () => <div>status rail</div> }));
vi.mock("./SettingsPopover.js", () => ({ SettingsPopover: () => <button>settings</button> }));

it("credits Franguh beside the OpenCohost brand with a safe external link", () => {
  render(<TopBar onShowWelcome={vi.fn()} />);
  const credit = screen.getByRole("link", { name: "Developed by Franguh" });
  expect(credit).toHaveAttribute("href", "https://github.com/franguh");
  expect(credit).toHaveAttribute("target", "_blank");
  expect(credit).toHaveAttribute("rel", "noreferrer");
});

it("drops the meaningless account avatar circle (the app has no user accounts)", () => {
  render(<TopBar onShowWelcome={vi.fn()} />);
  expect(screen.queryByLabelText("cuenta")).not.toBeInTheDocument();
});
