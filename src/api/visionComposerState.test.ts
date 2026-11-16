import { describe, expect, it } from "vitest";
import { visionComposerState, visionReasonKey, type VisionResponse } from "./vision.js";

function body(state: string | undefined, over: Partial<VisionResponse> = {}, lastError: string | null = null): VisionResponse {
  return {
    enabled: true,
    look_on_ptt: false,
    capture_delay_s: 0,
    rule_gate_enabled: false,
    model: "m",
    port: 1,
    describe_timeout_s: 8,
    status: {
      daemon_state: "running",
      model_installed: true,
      capture_available: true,
      armed: false,
      looking: false,
      state: state as never,
      last_error: lastError
    },
    ...over
  };
}

describe("visionComposerState", () => {
  it("is off without data or with vision disabled", () => {
    expect(visionComposerState(undefined)).toEqual({ phase: "off", reason: null });
    expect(visionComposerState(body("ready", { enabled: false }))).toEqual({ phase: "off", reason: null });
  });

  it("folds starting and warming into starting", () => {
    expect(visionComposerState(body("starting")).phase).toBe("starting");
    expect(visionComposerState(body("warming")).phase).toBe("starting");
  });

  it("is ready only on the backend's ready state", () => {
    expect(visionComposerState(body("ready")).phase).toBe("ready");
  });

  it("maps failed to error and carries the enum reason", () => {
    expect(visionComposerState(body("failed", {}, "port_in_use"))).toEqual({ phase: "error", reason: "port_in_use" });
  });

  it("has friendly copy keys for the daemon reason codes", () => {
    for (const code of ["warm_failed", "port_in_use", "ollama_not_found", "spawn_failed", "process_exited_early", "startup_timeout"]) {
      expect(visionReasonKey(code)).toBe(`experiencia.vision.reason.${code}`);
    }
  });
});
