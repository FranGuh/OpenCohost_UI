import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ComposerCommandPanel } from "./ComposerCommandPanel.js";
import { COMMANDS, matchCommands } from "./registry.js";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";

function renderPanel(query = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ComposerCommandPanel query={query} onClose={() => {}} />
    </QueryClientProvider>
  );
}

function visionHandler(enabled: boolean) {
  return http.get(`${API_BASE_URL}/api/vision`, () =>
    HttpResponse.json({
      enabled,
      look_on_ptt: false,
      capture_delay_s: 0,
      rule_gate_enabled: false,
      model: "qwen3-vl:4b-instruct",
      port: 11435,
      describe_timeout_s: 8,
      status: { daemon_state: "stopped", model_installed: null, capture_available: false, armed: false, looking: false }
    })
  );
}

describe("/mira command entry (U3)", () => {
  it("is registered and matched by /mira and the English alias /look", () => {
    expect(COMMANDS.some((c) => c.id === "mira")).toBe(true);
    expect(matchCommands("/mira").map((c) => c.id)).toContain("mira");
    expect(matchCommands("/look").map((c) => c.id)).toContain("mira");
  });

  it("opens a screen listing the look modes and the natural phrases", async () => {
    server.use(visionHandler(true));
    renderPanel("/mira");
    fireEvent.click(screen.getByRole("button", { name: /mira/i }));
    expect(await screen.findByText("/mira clip")).toBeTruthy();
    expect(screen.getByText("/mira texto")).toBeTruthy();
    expect(screen.getByText(/mira este clip/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Controles → Visión/)).toBeNull());
  });

  it("shows a hint pointing to Controles → Visión when vision is disabled", async () => {
    server.use(visionHandler(false));
    renderPanel("/mira");
    fireEvent.click(screen.getByRole("button", { name: /mira/i }));
    expect(await screen.findByText(/Controles → Visión/)).toBeTruthy();
  });
});
