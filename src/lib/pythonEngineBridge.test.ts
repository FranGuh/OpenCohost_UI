import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { demoState } from "../data/demoState.js";
import { createPythonEngineBridge } from "./pythonEngineBridge.js";

describe("pythonEngineBridge demo mode (regression guard)", () => {
  it("getState() returns the initial state unchanged", async () => {
    const bridge = createPythonEngineBridge("demo", demoState);
    await expect(bridge.getState()).resolves.toEqual(demoState);
  });

  it("non-status methods stay inert no-ops", async () => {
    const bridge = createPythonEngineBridge("demo", demoState);
    await expect(bridge.sendOperatorMessage("hi")).resolves.toBeUndefined();
    await expect(bridge.pauseAgenda()).resolves.toBeUndefined();
    await expect(bridge.resumeAgenda()).resolves.toBeUndefined();
    await expect(bridge.takeover()).resolves.toBeUndefined();
  });
});

describe("pythonEngineBridge http mode (design D2 — thin mapping)", () => {
  it("getState() delegates to client.ts's getStatus() and maps engine fields", async () => {
    const bridge = createPythonEngineBridge("http", demoState);
    const state = await bridge.getState();

    expect(state.engine.mode).toBe("http");
    expect(state.engine.readiness).toBe("ready");
    expect(state.engine.label).toBe(defaultStatus.current_model);
    // Everything the flat /api/status contract can't express falls back to
    // the provided template (no full CohostState bridge in P1 — YAGNI).
    expect(state.kira).toEqual(demoState.kira);
    expect(state.agenda).toEqual(demoState.agenda);
    expect(state.cards).toEqual(demoState.cards);
  });

  it("reflects is_ready:false as a non-ready readiness", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_ready: false }))
    );

    const bridge = createPythonEngineBridge("http", demoState);
    const state = await bridge.getState();

    expect(state.engine.readiness).not.toBe("ready");
  });

  it("non-status methods remain inert no-ops in http mode too (P1 scope)", async () => {
    const bridge = createPythonEngineBridge("http", demoState);
    await expect(bridge.sendOperatorMessage("hi")).resolves.toBeUndefined();
    await expect(bridge.pauseAgenda()).resolves.toBeUndefined();
    await expect(bridge.resumeAgenda()).resolves.toBeUndefined();
    await expect(bridge.takeover()).resolves.toBeUndefined();
  });
});
