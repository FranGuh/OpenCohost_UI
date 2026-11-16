import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { DecisionsCard } from "./DecisionsCard.js";

type Mode = "off" | "shadow" | "on";
interface Worker {
  configured: boolean;
  state: string;
  checkpoint: string | null;
  last_error: string | null;
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(DecisionsCard)));
}

function serve(opts: { worker?: Worker; putStatus?: number; gate?: Promise<void>; modes?: Partial<Record<string, Mode>> } = {}) {
  const state = {
    decisions: {
      vision: { mode: (opts.modes?.vision ?? "shadow") as Mode, threshold: 0.9 },
      memory: { mode: (opts.modes?.memory ?? "shadow") as Mode, threshold: 0.9 },
      reply_length: { mode: (opts.modes?.reply_length ?? "shadow") as Mode, threshold: 0.9 },
      respond: { mode: "shadow" as Mode, threshold: 0.9 }
    } as Record<string, { mode: Mode; threshold: number }>,
    worker: opts.worker ?? { configured: false, state: "unavailable", checkpoint: null, last_error: null },
    puts: [] as unknown[],
    restarts: 0
  };
  const snapshot = () => ({ decisions: state.decisions, worker: state.worker, budget_ms: 600 });
  server.use(
    http.get(`${API_BASE_URL}/api/decisions`, () => HttpResponse.json(snapshot())),
    http.put(`${API_BASE_URL}/api/decisions`, async ({ request }) => {
      const body = (await request.json()) as { decisions: Record<string, Partial<{ mode: Mode; threshold: number }>> };
      state.puts.push(body);
      if (opts.gate) await opts.gate;
      if (opts.putStatus && opts.putStatus !== 200) {
        const detail = opts.putStatus === 422 ? "invalid_decision_setting" : "decision_settings_write_failed";
        return HttpResponse.json({ detail }, { status: opts.putStatus });
      }
      for (const [id, patch] of Object.entries(body.decisions)) {
        state.decisions[id] = { ...state.decisions[id], ...patch } as { mode: Mode; threshold: number };
      }
      return HttpResponse.json(snapshot());
    }),
    http.post(`${API_BASE_URL}/api/decisions/worker/restart`, () => {
      state.restarts += 1;
      state.worker = { configured: true, state: "starting", checkpoint: "laya-1", last_error: null };
      return HttpResponse.json(state.worker);
    })
  );
  return state;
}

function row(name: string) {
  return screen.getByRole("group", { name });
}

describe("DecisionsCard", () => {
  // Test default locale is es; assert on the en copy unless stated.
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("shows loading, then one row per decision with Off / Shadow / On", async () => {
    serve();
    renderCard();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Decisions (Laya)" })).toBeInTheDocument();
    for (const name of ["Vision", "Memory", "Reply length", "Answer chat"]) {
      expect(await screen.findByRole("group", { name })).toBeInTheDocument();
    }
    const vision = within(row("Vision"));
    expect(vision.getAllByRole("button").map((b) => b.textContent)).toEqual(["Off", "Shadow", "On"]);
    expect(vision.getByRole("button", { name: "Shadow" })).toHaveAttribute("aria-pressed", "true");
  });

  it("explains shadow and describes each row via aria-describedby", async () => {
    serve();
    renderCard();
    const group = await screen.findByRole("group", { name: "Vision" });
    const hint = document.getElementById(group.getAttribute("aria-describedby") ?? "none");
    expect(hint).toHaveTextContent(/screen/i);
    expect(screen.getByText("Shadow: Laya decides and it is logged, but the current rules act.")).toBeInTheDocument();
  });

  it("respond has no On option and shows the shadow-only note", async () => {
    serve();
    renderCard();
    const respond = within(await screen.findByRole("group", { name: "Answer chat" }));
    expect(respond.getAllByRole("button").map((b) => b.textContent)).toEqual(["Off", "Shadow"]);
    expect(screen.getByText("Shadow only: Laya never decides this one yet.")).toBeInTheDocument();
  });

  it("saves a mode change immediately with a partial PUT", async () => {
    const user = userEvent.setup();
    const state = serve();
    renderCard();
    await user.click(within(await screen.findByRole("group", { name: "Memory" })).getByRole("button", { name: "On" }));
    await waitFor(() => expect(state.puts).toEqual([{ decisions: { memory: { mode: "on" } } }]));
    await waitFor(() =>
      expect(within(row("Memory")).getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true")
    );
  });

  it("updates optimistically while the save is in flight", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    serve({ gate });
    renderCard();
    const off = within(await screen.findByRole("group", { name: "Vision" })).getByRole("button", { name: "Off" });
    await user.click(off);
    await waitFor(() => expect(off).toHaveAttribute("aria-pressed", "true"));
    release();
  });

  it("threshold input is disabled unless the mode is on", async () => {
    serve({ modes: { vision: "on" } });
    renderCard();
    expect(await screen.findByLabelText("Vision threshold")).toBeEnabled();
    expect(screen.getByLabelText("Memory threshold")).toBeDisabled();
    expect(screen.getByLabelText("Answer chat threshold")).toBeDisabled();
  });

  it("commits a threshold on blur with a partial PUT, clamped to 0.50-0.99", async () => {
    const user = userEvent.setup();
    const state = serve({ modes: { vision: "on" } });
    renderCard();
    const input = await screen.findByLabelText("Vision threshold");
    await user.clear(input);
    await user.type(input, "0.75");
    await user.tab();
    await waitFor(() => expect(state.puts).toEqual([{ decisions: { vision: { threshold: 0.75 } } }]));
    await user.clear(input);
    await user.type(input, "2");
    await user.tab();
    await waitFor(() => expect(state.puts[1]).toEqual({ decisions: { vision: { threshold: 0.99 } } }));
  });

  it("rolls back and shows an inline error on 422", async () => {
    const user = userEvent.setup();
    serve({ putStatus: 422 });
    renderCard();
    await user.click(within(await screen.findByRole("group", { name: "Vision" })).getByRole("button", { name: "Off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Laya rejected that setting.");
    await waitFor(() =>
      expect(within(row("Vision")).getByRole("button", { name: "Shadow" })).toHaveAttribute("aria-pressed", "true")
    );
  });

  it("shows a save error on 503", async () => {
    const user = userEvent.setup();
    serve({ putStatus: 503 });
    renderCard();
    await user.click(within(await screen.findByRole("group", { name: "Vision" })).getByRole("button", { name: "Off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the decisions. Try again.");
  });

  it("shows an error when the GET fails", async () => {
    server.use(http.get(`${API_BASE_URL}/api/decisions`, () => new HttpResponse(null, { status: 500 })));
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the decisions.");
  });

  it.each([
    [{ configured: true, state: "ready", checkpoint: "c", last_error: null }, "Ready"],
    [{ configured: true, state: "starting", checkpoint: "c", last_error: null }, "Loading model…"],
    [
      { configured: false, state: "unavailable", checkpoint: null, last_error: null },
      "Not configured: Kira uses the current rules"
    ],
    [{ configured: false, state: "off", checkpoint: null, last_error: null }, "Not configured: Kira uses the current rules"]
  ])("maps worker state %j to the label %s", async (worker, label) => {
    serve({ worker });
    renderCard();
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
  });

  it("on error shows the code only and a Restart button that calls the endpoint", async () => {
    const user = userEvent.setup();
    const state = serve({ worker: { configured: true, state: "error", checkpoint: "c", last_error: "model_load_failed" } });
    renderCard();
    expect(await screen.findByText("Error")).toBeInTheDocument();
    expect(screen.getByText("model_load_failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(state.restarts).toBe(1));
    expect(await screen.findByText("Loading model…")).toBeInTheDocument();
  });

  it("renders neutral Spanish copy", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve();
    renderCard();
    expect(await screen.findByRole("heading", { name: "Decisiones (Laya)" })).toBeInTheDocument();
    for (const name of ["Visión", "Memoria", "Longitud de respuesta", "Responder al chat"]) {
      expect(await screen.findByRole("group", { name })).toBeInTheDocument();
    }
    expect(within(row("Visión")).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Apagado",
      "Sombra",
      "Activo"
    ]);
    expect(screen.getByText("Sombra: Laya decide y se registra, pero actúan las reglas actuales.")).toBeInTheDocument();
    expect(screen.getByText("No configurado: Kira usa las reglas actuales")).toBeInTheDocument();
  });

  it("collapses and expands on header click, persisting state to localStorage", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    serve();
    renderCard();
    const header = await screen.findByRole("button", { name: /Decisions \(Laya\)/i });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("oc-collapse-decisions-laya")).toBe("0");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("oc-collapse-decisions-laya")).toBe("1");
  });
});
