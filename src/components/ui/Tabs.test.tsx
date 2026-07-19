import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from "./Tabs.js";

/** Controlled harness — the primitive is controlled, so a wrapper owns value. */
function Harness({ onValueChange }: { onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState("uno");
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    >
      <TabList ariaLabel="Ejemplo">
        <Tab value="uno">Uno</Tab>
        <Tab value="dos">Dos</Tab>
        <Tab value="tres">Tres</Tab>
      </TabList>
      <TabPanel value="uno">Panel uno</TabPanel>
      <TabPanel value="dos">Panel dos</TabPanel>
      <TabPanel value="tres">Panel tres</TabPanel>
    </Tabs>
  );
}

describe("Tabs primitive (R4/D1/D2)", () => {
  it("wires the tablist / tab / tabpanel role + aria contract with roving tabIndex", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist", { name: "Ejemplo" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    const [uno, dos] = tabs;

    expect(uno).toHaveAttribute("aria-selected", "true");
    expect(dos).toHaveAttribute("aria-selected", "false");
    // Roving tabIndex: only the selected tab is in the tab order.
    expect(uno).toHaveAttribute("tabindex", "0");
    expect(dos).toHaveAttribute("tabindex", "-1");

    // Only the active panel is in the accessibility tree; it's wired to its tab.
    const panel = screen.getByRole("tabpanel");
    expect(uno).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", uno.id);
    expect(panel).toHaveTextContent("Panel uno");
  });

  it("selects a tab on click and calls onValueChange", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "Dos" }));

    expect(onValueChange).toHaveBeenCalledWith("dos");
    expect(screen.getByRole("tab", { name: "Dos" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel dos");
  });

  it("moves focus and selection with ArrowRight/ArrowLeft and clamps at both ends", () => {
    render(<Harness />);
    screen.getByRole("tab", { name: "Uno" }).focus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Uno" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Dos" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Dos" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Dos" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Tres" })).toHaveFocus();

    // Clamp at the right end — ArrowRight on the last tab stays put.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Tres" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Tres" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Tres" })).toHaveAttribute("aria-selected", "true");

    // Walk back to the left end and clamp.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Tres" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Dos" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Uno" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Uno" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Uno" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Uno" })).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the first/last tab with Home/End", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Dos" }));
    screen.getByRole("tab", { name: "Dos" }).focus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Dos" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Tres" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Tres" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Uno" })).toHaveFocus();
  });

  it("keeps an inactive panel mounted — child state survives a switch away and back (D2/R6)", () => {
    function StateHarness() {
      const [value, setValue] = useState("uno");
      return (
        <Tabs value={value} onValueChange={setValue}>
          <TabList ariaLabel="Ejemplo">
            <Tab value="uno">Uno</Tab>
            <Tab value="dos">Dos</Tab>
          </TabList>
          <TabPanel value="uno">
            <input aria-label="campo" />
          </TabPanel>
          <TabPanel value="dos">Panel dos</TabPanel>
        </Tabs>
      );
    }
    render(<StateHarness />);
    const field = screen.getByLabelText("campo") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "persistí" } });

    fireEvent.click(screen.getByRole("tab", { name: "Dos" }));
    fireEvent.click(screen.getByRole("tab", { name: "Uno" }));

    // A remount would reset the uncontrolled input to ""; surviving value proves
    // the inactive panel was hidden, never unmounted.
    expect((screen.getByLabelText("campo") as HTMLInputElement).value).toBe("persistí");
  });

  it("hides inactive panels from the accessibility tree while keeping them in the DOM", () => {
    render(<Harness />);
    // Only one tabpanel is accessible (the rest carry hidden + inert + aria-hidden)…
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    // …but the inactive panels' text is still present in the DOM (mounted).
    expect(screen.getByText("Panel dos")).toBeInTheDocument();
    expect(screen.getByText("Panel tres")).toBeInTheDocument();
  });
});
