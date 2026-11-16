import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import type { VisionStatus } from "../../api/vision.js";
import { useVisionPhaseStore } from "../../store/visionStore.js";
import { VisionLookControl } from "./VisionLookControl.js";

function renderControl() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(VisionLookControl)));
}

function serve(enabled: boolean, status: Partial<VisionStatus> = {}, look: () => Response = () => HttpResponse.json({ armed: true })) {
  const state = {
    enabled,
    status: { daemon_state: "running", model_installed: true, capture_available: true, armed: false, looking: false, ...status },
    looks: 0
  };
  server.use(
    http.get(`${API_BASE_URL}/api/vision`, () =>
      HttpResponse.json({
        enabled: state.enabled,
        look_on_ptt: false,
        capture_delay_s: 0,
        rule_gate_enabled: false,
        model: "qwen3-vl:4b-instruct",
        port: 11435,
        describe_timeout_s: 8,
        status: state.status
      })
    ),
    http.post(`${API_BASE_URL}/api/vision/look`, () => {
      state.looks += 1;
      const res = look();
      if (res.ok) state.status = { ...state.status, armed: true };
      return res;
    })
  );
  return state;
}

describe("VisionLookControl", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("is disabled while vision is off", async () => {
    serve(false);
    renderControl();
    const button = await screen.findByRole("button", { name: "Vision off" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Turn on vision in Controls to use this");
    expect(screen.queryByRole("button", { name: "Look at this" })).toBeNull();
  });

  it.each([
    ["starting", "Vision warming up…"],
    ["warming", "Vision warming up…"],
    ["failed", "Vision unavailable"]
  ] as const)("is disabled and honest while vision is %s", async (state, name) => {
    serve(true, { state });
    renderControl();
    const button = await screen.findByRole("button", { name });
    expect(button).toBeDisabled();
  });

  it("only offers Look at this once vision is ready", async () => {
    serve(true, { state: "ready" });
    renderControl();
    const button = await screen.findByRole("button", { name: "Look at this" });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("stays an inline control, not a banner", async () => {
    serve(true);
    renderControl();
    const button = await screen.findByRole("button", { name: "Look at this" });
    expect(button.parentElement).not.toHaveClass("fixed");
    expect(button.parentElement).not.toHaveClass("absolute");
  });

  it("arms the look on click and shows the armed state", async () => {
    const state = serve(true);
    renderControl();
    const button = await screen.findByRole("button", { name: "Look at this" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(state.looks).toBe(1));
    expect(await screen.findByText("Kira will look on your next message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look at this" })).toBeDisabled();
  });

  it("says it is processing the frames in the describing phase, even if the status poll already reports looking=false", async () => {
    serve(true, { looking: false });
    useVisionPhaseStore.setState({ phase: "describing" });
    renderControl();
    expect(await screen.findByRole("status")).toHaveTextContent("Processing what I saw…");
    useVisionPhaseStore.setState({ phase: "idle" });
  });

  it("shows the Kira is looking indicator while looking", async () => {
    serve(true, { looking: true });
    renderControl();
    expect(await screen.findByRole("status")).toHaveTextContent("Kira is looking…");
  });

  it("shows no indicator when idle", async () => {
    serve(true);
    renderControl();
    await screen.findByRole("button", { name: "Look at this" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an inline error when arming fails", async () => {
    serve(true, {}, () => HttpResponse.json({ detail: "vision_disabled" }, { status: 409 }) as unknown as Response);
    renderControl();
    const button = await screen.findByRole("button", { name: "Look at this" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not arm the look. Try again.");
  });
});
