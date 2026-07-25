import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStore, type AppEvent } from "../../store/eventStore.js";
import { LogsPanel } from "./LogsPanel.js";

function seed(events: AppEvent[]) {
  useEventStore.setState({ events });
}

beforeEach(() => {
  useEventStore.setState({ events: [] });
});

describe("LogsPanel (R10/R32 — privacy whitelist only)", () => {
  it("renders the source and label metadata from each AppEvent", () => {
    seed([{ id: "e1", ts: Date.parse("2026-07-18T14:05:30"), source: "model", label: "Modelo → qwen3:8b", tone: "ok" }]);
    render(<LogsPanel />);
    expect(screen.getByText("Modelo → qwen3:8b")).toBeInTheDocument();
    expect(screen.getByText("model")).toBeInTheDocument();
  });

  it("renders the label verbatim — nothing beyond the typed fields leaks", () => {
    seed([{ id: "e2", ts: Date.now(), source: "motor", label: "Motor: listo", tone: "info" }]);
    render(<LogsPanel />);
    const label = screen.getByText("Motor: listo");
    // Exact text node — no `detail` or any other field folded into the label.
    expect(label.textContent).toBe("Motor: listo");
  });

  it("shows an explicit empty state when there are no events", () => {
    render(<LogsPanel />);
    expect(screen.getByText(/no hay eventos/i)).toBeInTheDocument();
  });

  it("orders events chronologically — oldest at the top, newest at the bottom (Item 3)", () => {
    seed([
      { id: "old", ts: 1000, source: "obs", label: "OBS activado", tone: "ok" },
      { id: "new", ts: 2000, source: "stream", label: "Stream conectado", tone: "ok" }
    ]);
    const { container } = render(<LogsPanel />);
    const text = container.textContent ?? "";
    expect(text.indexOf("OBS activado")).toBeLessThan(text.indexOf("Stream conectado"));
  });

  it("renders plain mono rows (hh:mm:ss · source — label) with no Badge/Alert chrome (Item 4)", () => {
    seed([{ id: "e1", ts: Date.parse("2026-07-18T14:05:30"), source: "model", label: "Modelo → qwen3:8b", tone: "ok" }]);
    const { container } = render(<LogsPanel />);

    // No Alert live-region wrapper and no Badge/Alert data-tone pill in the row.
    expect(container.querySelector("[role='status']")).toBeNull();
    expect(container.querySelector(".oc-alert")).toBeNull();
    expect(container.querySelector("[data-tone]")).toBeNull();

    // timestamp + separator + source + label all present as plain text.
    const row = screen.getByText("Modelo → qwen3:8b").closest("li") as HTMLElement;
    expect(row.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(row.textContent).toContain("·");
    expect(row.textContent).toContain("model");
    expect(row.textContent).toContain("Modelo → qwen3:8b");
  });

  it("follows the bottom when a new event arrives and the operator is near it (Item 4 autoscroll)", () => {
    seed([{ id: "a", ts: 1000, source: "obs", label: "primero", tone: "ok" }]);
    const { container } = render(<LogsPanel />);
    const scroller = container.firstChild as HTMLElement;

    // jsdom reports 0 for layout metrics — emulate a scrolled-to-bottom viewport.
    Object.defineProperty(scroller, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 420, configurable: true });
    scroller.scrollTop = 0; // 500 - 0 - 420 = 80 <= NEAR_BOTTOM_PX(80) → near bottom

    act(() => {
      useEventStore.setState({
        events: [
          { id: "a", ts: 1000, source: "obs", label: "primero", tone: "ok" },
          { id: "b", ts: 2000, source: "stream", label: "segundo", tone: "ok" }
        ]
      });
    });

    expect(scroller.scrollTop).toBe(500);
  });

  it("does NOT yank the view when a new event arrives while scrolled up reading history (Item 4)", () => {
    seed([{ id: "a", ts: 1000, source: "obs", label: "primero", tone: "ok" }]);
    const { container } = render(<LogsPanel />);
    const scroller = container.firstChild as HTMLElement;

    Object.defineProperty(scroller, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 100, configurable: true });
    scroller.scrollTop = 0; // 500 - 0 - 100 = 400 > 80 → far from bottom

    act(() => {
      useEventStore.setState({
        events: [
          { id: "a", ts: 1000, source: "obs", label: "primero", tone: "ok" },
          { id: "b", ts: 2000, source: "stream", label: "segundo", tone: "ok" }
        ]
      });
    });

    // Left where the operator put it — no forced jump to the bottom.
    expect(scroller.scrollTop).toBe(0);
  });
});

/**
 * Progressive-slowdown guard (2026-07-24). `formatTs` built a fresh locale
 * formatter per row via `Date#toLocaleTimeString(locale, opts)` — the most
 * expensive call in the row — for up to EVENT_CAP (200) rows, on EVERY parent
 * render. Worse, Tabs keeps inactive panels MOUNTED by design (Tabs.tsx), so
 * this ran even while the Logs tab was hidden and nobody was looking at it.
 * One hoisted module-level Intl.DateTimeFormat does the same job once.
 */
describe("LogsPanel timestamp formatting cost", () => {
  it("never builds a per-row locale formatter, even across re-renders", () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleTimeString");
    const base = Date.parse("2026-07-18T14:05:30");
    seed(
      Array.from({ length: 120 }, (_, i) => ({
        id: `e${i}`,
        ts: base + i * 1000,
        source: "motor" as const,
        label: `Motor: evento ${i}`,
        tone: "info" as const
      }))
    );

    const { rerender } = render(<LogsPanel />);
    rerender(<LogsPanel />);
    rerender(<LogsPanel />);

    expect(spy).not.toHaveBeenCalled();
    // ...and the rendered output is byte-identical to what the per-row
    // Date#toLocaleTimeString("es-AR", opts) produced (verified: both emit
    // "02:05:30 p. m."), so this is a pure cost change, not a format change.
    expect(screen.getByText("Motor: evento 0")).toBeInTheDocument();
    const expected = new Intl.DateTimeFormat("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(base);
    expect(expected).toBe(new Date(base).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    spy.mockRestore();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
