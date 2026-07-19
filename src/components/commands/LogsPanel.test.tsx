import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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

  it("orders the newest event first", () => {
    seed([
      { id: "old", ts: 1000, source: "obs", label: "OBS activado", tone: "ok" },
      { id: "new", ts: 2000, source: "stream", label: "Stream conectado", tone: "ok" }
    ]);
    const { container } = render(<LogsPanel />);
    const text = container.textContent ?? "";
    expect(text.indexOf("Stream conectado")).toBeLessThan(text.indexOf("OBS activado"));
  });
});
