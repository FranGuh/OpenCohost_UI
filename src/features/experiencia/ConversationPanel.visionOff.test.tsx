import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { useVisionOffRequestStore } from "../../store/visionStore.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { ConversationPanel } from "./ConversationPanel.js";

vi.mock("../../api/liveTranscript.js", () => ({ useLiveTranscript: () => undefined }));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

type Phase = "off" | "starting" | "warming" | "ready" | "failed";

function visionBody(phase: Phase) {
  return {
    enabled: phase !== "off",
    look_on_ptt: false,
    capture_delay_s: 0,
    rule_gate_enabled: false,
    model: "m",
    port: 1,
    describe_timeout_s: 8,
    status: { daemon_state: "stopped", model_installed: true, capture_available: true, armed: false, looking: false, state: phase }
  };
}

/** GET serves the current phase; PUT records its body and flips the phase. */
function serveVision(initial: Phase, afterPut: Phase = "warming") {
  const state = { phase: initial, puts: [] as unknown[] };
  server.use(
    http.get(`${API_BASE_URL}/api/vision`, () => HttpResponse.json(visionBody(state.phase))),
    http.put(`${API_BASE_URL}/api/vision`, async ({ request }) => {
      state.puts.push(await request.json());
      state.phase = afterPut;
      return HttpResponse.json(visionBody(afterPut));
    })
  );
  return state;
}

describe("ConversationPanel vision-off quick enable", () => {
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "es" });
    useVisionOffRequestStore.setState({ requests: [] });
  });
  afterEach(() => {
    useUiLocaleStore.setState({ locale: "es" });
    useVisionOffRequestStore.setState({ requests: [] });
  });

  it("renders the row with an enabled button when vision is off and PUTs enabled:true on click", async () => {
    const state = serveVision("off", "warming");
    useVisionOffRequestStore.setState({ requests: [{ id: "srv-1", ts: Date.now() }] });
    renderPanel();
    expect(await screen.findByText("Mi visión está apagada.")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Activar visión" }));
    await waitFor(() => expect(state.puts).toEqual([{ enabled: true }]));
    expect(await screen.findByText("Encendiendo la visión…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar visión" })).toBeNull();
  });

  it("shows the ready text once vision is ready", async () => {
    serveVision("off", "ready");
    useVisionOffRequestStore.setState({ requests: [{ id: "srv-1", ts: Date.now() }] });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Activar visión" }));
    expect(await screen.findByText("Visión lista. Pídeme de nuevo que mire.")).toBeInTheDocument();
  });

  it("shows the failed text when vision failed to start", async () => {
    serveVision("off", "failed");
    useVisionOffRequestStore.setState({ requests: [{ id: "srv-1", ts: Date.now() }] });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Activar visión" }));
    expect(await screen.findByText("No pude encender la visión. Revisa Controles › Visión.")).toBeInTheDocument();
  });

  it("shows no button when vision is already enabled", async () => {
    serveVision("warming");
    useVisionOffRequestStore.setState({ requests: [{ id: "srv-1", ts: Date.now() }] });
    renderPanel();
    expect(await screen.findByText("Encendiendo la visión…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar visión" })).toBeNull();
  });

  it("gives only the most recent request the live button; older rows are static text", async () => {
    serveVision("off");
    useVisionOffRequestStore.setState({
      requests: [
        { id: "srv-1", ts: Date.now() - 5000 },
        { id: "srv-2", ts: Date.now() }
      ]
    });
    renderPanel();
    expect(await screen.findAllByRole("button", { name: "Activar visión" })).toHaveLength(1);
    expect(screen.getByText("Mi visión estaba apagada.")).toBeInTheDocument();
  });

  it("uses English copy under the en locale", async () => {
    useUiLocaleStore.setState({ locale: "en" });
    serveVision("off");
    useVisionOffRequestStore.setState({ requests: [{ id: "srv-1", ts: Date.now() }] });
    renderPanel();
    expect(await screen.findByText("My vision is off.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on vision" })).toBeInTheDocument();
  });
});

describe("ConversationPanel vision-off row structure", () => {
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "es" });
    useVisionOffRequestStore.setState({ requests: [] });
  });

  it("lays icon, message, action and time out in one centered row, in that order", async () => {
    const state = serveVision("off", "warming");
    useVisionOffRequestStore.setState({ requests: [{ id: "srv-1", ts: Date.now() }] });
    renderPanel();
    const message = await screen.findByText("Mi visión está apagada.");
    const row = message.closest("[data-vision-off-row]") as HTMLElement;
    expect(row).not.toBeNull();
    const kids = Array.from(row.children);
    expect(kids).toHaveLength(4);
    expect(kids[0].tagName.toLowerCase()).toBe("svg");
    expect(kids[0]).toHaveAttribute("aria-hidden", "true");
    expect(kids[1]).toContainElement(message);
    expect(kids[2].tagName).toBe("BUTTON");
    // Same shape as the composer's send button, in the quieter accent-soft tone.
    expect(kids[2]).toHaveClass("oc-alert-row-action");
    expect(kids[3].tagName).toBe("TIME");
    expect(row.className).toContain("oc-alert-row");
    await userEvent.click(kids[2] as HTMLElement);
    await waitFor(() => expect(state.puts).toEqual([{ enabled: true }]));
  });
});
