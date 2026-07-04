import { describe, expect, it } from "vitest";
import type { StatusResponse } from "../api/client.js";
import { deriveAvatarState } from "./kiraState.js";

// deriveAvatarState only reads health.overall_status, but StatusResponse["health"]
// requires the full backend shape — this fixture fills the rest with placeholders.
function makeHealth(overall_status: string): StatusResponse["health"] {
  return {
    vram_status: "ok",
    rtf_status: "ok",
    ollama_status: "ok",
    qwen_status: "ok",
    overall_status,
    ollama_lifecycle: "running",
    qwen_lifecycle: "running",
    free_vram_mb: 4096,
    rtf_rolling_avg: 0.3,
    last_updated: 0
  };
}

describe("deriveAvatarState (F2)", () => {
  it("stays idle when system health is danger but Kira pipeline is idle/ready", () => {
    expect(
      deriveAvatarState({
        is_speaking: false,
        is_processing: false,
        is_ready: true,
        health: makeHealth("red")
      })
    ).toBe("idle");
  });

  it("is sleeping when not ready, even if health is danger", () => {
    expect(
      deriveAvatarState({
        is_speaking: false,
        is_processing: false,
        is_ready: false,
        health: makeHealth("red")
      })
    ).toBe("sleeping");
  });
});

describe("deriveAvatarState (F4 — prefers backend avatar_state)", () => {
  it("uses data.avatar_state when the backend supplies it", () => {
    expect(
      deriveAvatarState({
        is_speaking: false,
        is_processing: false,
        is_ready: true,
        health: makeHealth("green"),
        avatar_state: "listening"
      })
    ).toBe("listening");
  });

  it("falls back to derivation when avatar_state is absent", () => {
    expect(
      deriveAvatarState({
        is_speaking: true,
        is_processing: false,
        is_ready: true,
        health: makeHealth("green")
      })
    ).toBe("speaking");
  });
});
