import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { AGENDA_TURN_OPTIONS } from "../api/agenda.js";
import { AgendaPanel } from "./AgendaPanel.js";
import { COMMANDS } from "./commands/registry.js";
import type { StepDef } from "./commands/primitives.js";
import { ToastProvider } from "../ui/Toast.js";

/**
 * Drift guard for the verified "Intentos por tema" defect: the Tauri front used
 * to carry TWO independent hardcoded option lists — AgendaPanel's [1,2,3,5,8]
 * and the /perfil command's [3,5,8] — that both capped below the backend's
 * real 1..20 range and disagreed with each other. Both now read
 * AGENDA_TURN_OPTIONS (src/api/agenda.ts); these tests fail if either call
 * site reverts to a local copy or the shared range narrows again.
 */

function renderAgendaPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ToastProvider, null, React.createElement(AgendaPanel))
    )
  );
}

describe("AGENDA_TURN_OPTIONS is the single source for the turn-limit dropdown", () => {
  it("covers 1..20 contiguously (mirrors KiraAgendaController.MIN/MAX_TURNS_PER_TOPIC)", () => {
    expect(AGENDA_TURN_OPTIONS.map((o) => o.value)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1))
    );
    expect(AGENDA_TURN_OPTIONS.every((o) => o.value === o.label)).toBe(true);
  });

  it("/perfil's turnos step reads the exact same array — not a local copy", () => {
    const perfil = COMMANDS.find((command) => command.id === "perfil");
    const turnosStep = perfil?.steps?.find(
      (step): step is Extract<StepDef, { kind: "select" }> => step.id === "turnos" && step.kind === "select"
    );
    expect(turnosStep?.options).toBe(AGENDA_TURN_OPTIONS);
  });

  it("AgendaPanel's 'Intentos por tema' Select renders the full 1..20 range, not a stale subset", async () => {
    renderAgendaPanel();
    fireEvent.click(await screen.findByRole("combobox", { name: "Intentos por tema" }));
    // Strip the selected-option "✓" decoration (aria-hidden, but textContent
    // doesn't know that) so this compares labels only.
    const options = screen.getAllByRole("option").map((el) => el.textContent?.replace("✓", "").trim());
    expect(options).toEqual(AGENDA_TURN_OPTIONS.map((o) => o.label));
  });
});
