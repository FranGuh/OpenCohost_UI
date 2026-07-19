import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubCollapsibleSection, useCollapsible } from "./Collapsible.js";

const KEY = "oc-collapse-test-section";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useCollapsible", () => {
  it("defaults to open (true) and toggles in memory, never touching localStorage without a persistKey", () => {
    const { result } = renderHook(() => useCollapsible());
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());

    expect(result.current[0]).toBe(false);
    // No persistKey -> no key written anywhere.
    expect(window.localStorage.length).toBe(0);
  });

  it("honours an explicit defaultOpen=false with no persistKey", () => {
    const { result } = renderHook(() => useCollapsible(false));
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it("hydrates the initial state from localStorage when a persistKey is set", () => {
    window.localStorage.setItem(KEY, "0");
    const { result } = renderHook(() => useCollapsible(true, "test-section"));
    // Stored "0" wins over defaultOpen=true.
    expect(result.current[0]).toBe(false);

    window.localStorage.setItem(KEY, "1");
    const second = renderHook(() => useCollapsible(false, "test-section"));
    // Stored "1" wins over defaultOpen=false.
    expect(second.result.current[0]).toBe(true);
  });

  it("falls back to defaultOpen when the persistKey has no stored value yet", () => {
    const open = renderHook(() => useCollapsible(true, "test-section"));
    expect(open.result.current[0]).toBe(true);

    window.localStorage.clear();
    const closed = renderHook(() => useCollapsible(false, "test-section"));
    expect(closed.result.current[0]).toBe(false);
  });

  it("writes the new state through to localStorage on every toggle when a persistKey is set", () => {
    const { result } = renderHook(() => useCollapsible(true, "test-section"));

    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe("0");

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");
  });
});

describe("SubCollapsibleSection", () => {
  it("renders its children and is open by default", () => {
    render(
      <SubCollapsibleSection title="Sub" persistKey="sub-a">
        <p>sub child</p>
      </SubCollapsibleSection>
    );
    expect(screen.getByText("sub child")).toBeInTheDocument();
    const header = screen.getByRole("button", { name: /Sub/ });
    expect(header).toHaveAttribute("aria-expanded", "true");

    // Open: body is visible and reachable — no inert, aria-hidden="false" —
    // and the header's aria-controls points at the body's real id.
    const bodyId = header.getAttribute("aria-controls");
    expect(bodyId).toBeTruthy();
    const body = document.getElementById(bodyId as string) as HTMLElement;
    expect(body).not.toHaveAttribute("inert");
    expect(body).toHaveAttribute("aria-hidden", "false");
    expect(body).toContainElement(screen.getByText("sub child"));
  });

  it("marks a default-closed body inert/aria-hidden before it's ever expanded — the destructive-action hazard this guards against", () => {
    render(
      <SubCollapsibleSection title="Sub" persistKey="sub-closed" defaultOpen={false}>
        <button type="button">danger</button>
      </SubCollapsibleSection>
    );
    const header = screen.getByRole("button", { name: /Sub/ });
    const bodyId = header.getAttribute("aria-controls");
    expect(bodyId).toBeTruthy();
    const body = document.getElementById(bodyId as string) as HTMLElement;
    expect(body).toHaveAttribute("inert");
    expect(body).toHaveAttribute("aria-hidden", "true");
  });

  it("honours defaultOpen=false and persists the toggle through to localStorage", () => {
    render(
      <SubCollapsibleSection title="Sub" persistKey="sub-b" defaultOpen={false}>
        <p>sub child</p>
      </SubCollapsibleSection>
    );
    const header = screen.getByRole("button", { name: /Sub/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    const bodyId = header.getAttribute("aria-controls") as string;
    expect(document.getElementById(bodyId)).toHaveAttribute("inert");

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("oc-collapse-sub-b")).toBe("1");
    // Re-opened: inert/aria-hidden lift, the body becomes reachable again.
    expect(document.getElementById(bodyId)).not.toHaveAttribute("inert");
    expect(document.getElementById(bodyId)).toHaveAttribute("aria-hidden", "false");
  });

  it("hydrates its initial open state from localStorage (persistKey)", () => {
    window.localStorage.setItem("oc-collapse-sub-c", "0");
    render(
      <SubCollapsibleSection title="Sub" persistKey="sub-c" defaultOpen>
        <p>sub child</p>
      </SubCollapsibleSection>
    );
    // Stored "0" wins over defaultOpen=true.
    expect(screen.getByRole("button", { name: /Sub/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles via the keyboard (Enter) — reuses CollapsibleHeader semantics", () => {
    render(
      <SubCollapsibleSection title="Sub" persistKey="sub-d" defaultOpen={false}>
        <p>sub child</p>
      </SubCollapsibleSection>
    );
    const header = screen.getByRole("button", { name: /Sub/ });
    fireEvent.keyDown(header, { key: "Enter" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("oc-collapse-sub-d")).toBe("1");
  });
});
