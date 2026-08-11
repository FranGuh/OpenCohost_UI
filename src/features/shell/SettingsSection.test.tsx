import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PANEL_CLASS, SettingsSection } from "./SettingsSection.js";

// jsdom has no layout engine (docs/UI_CONSTRAINTS_LEARNED.md §3): these tests
// prove DOM ancestry only — the header sits outside the scrolling element,
// never whether it visually stays put or whether the body actually scrolls.

describe("SettingsSection", () => {
  it("keeps the header out of the scrolling body — a sibling of the overflow-auto element, not a descendant", () => {
    render(
      <SettingsSection header={<div data-testid="header-marker">Switcher</div>}>
        <div data-testid="body-marker">Body content</div>
      </SettingsSection>
    );

    const header = screen.getByTestId("header-marker");
    const scrollBody = document.querySelector(".overflow-auto");
    expect(scrollBody).not.toBeNull();

    // Not a descendant of the scrolling element.
    expect(scrollBody).not.toContainElement(header);

    // A sibling instead: both the header's wrapper and the scroll body share
    // the same parent <main>, immediately next to each other in document order.
    expect(header.parentElement?.nextElementSibling).toBe(scrollBody);
    expect(header.parentElement?.parentElement?.tagName).toBe("MAIN");
  });

  it("renders a single <main> carrying PANEL_CLASS when there is no header", () => {
    render(
      <SettingsSection>
        <div data-testid="body-marker">Body content</div>
      </SettingsSection>
    );

    const mains = document.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    for (const cls of PANEL_CLASS.split(" ")) {
      expect(mains[0]).toHaveClass(cls);
    }
    expect(screen.getByTestId("body-marker")).toBeInTheDocument();
  });
});
