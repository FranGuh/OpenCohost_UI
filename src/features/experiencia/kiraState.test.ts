import { describe, expect, it } from "vitest";
import type { StatusResponse } from "../../api/client.js";
import { LOCAL_SLEEP_LABEL, deriveAvatarState, resolveAvatar } from "./kiraState.js";

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
    last_updated: 0,
    // These six carry a `default` in HealthState, so the server always sends
    // them. The fixture predates them and types.gen.ts was six weeks stale, so
    // nothing could say the placeholder shape had fallen behind the payload.
    total_vram_mb: 0,
    used_vram_mb: 0,
    model_resident_mb_est: null,
    model_vram_mb_est: null,
    model_ram_spill_mb_est: null,
    model_processor_split: null
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

// `avatar_state` is deliberately ABSENT: these cases exercise the derivation
// fallback, and supplying it would short-circuit the very branch under test
// (`deriveAvatarState` returns the backend field verbatim when present).
// The parameter type marks it optional for exactly this reason.
const idleStatus = {
  is_speaking: false,
  is_processing: false,
  is_ready: true,
  health: makeHealth("green")
};

describe("resolveAvatar: client-side overrides", () => {
  it("shows listening while a PTT hold is open, even though the poll says idle", () => {
    // The whole point of defect B: the backend deriver cannot emit "listening",
    // so the hold has to reach the avatar client-side.
    expect(resolveAvatar(idleStatus, { livePtt: true }).state).toBe("listening");
  });

  it("gives listening precedence over speaking — they are mutually exclusive", () => {
    expect(resolveAvatar({ ...idleStatus, is_speaking: true }, { livePtt: true, liveSpeaking: true }).state).toBe(
      "listening"
    );
  });

  it("alternates speaking <-> speaking_alt with the alt phase (CTK parity)", () => {
    expect(resolveAvatar(idleStatus, { liveSpeaking: true, alt: false }).state).toBe("speaking");
    expect(resolveAvatar(idleStatus, { liveSpeaking: true, alt: true }).state).toBe("speaking_alt");
    // Also applies to poll-derived speaking, not just the live edge.
    expect(resolveAvatar({ ...idleStatus, is_speaking: true }, { alt: true }).state).toBe("speaking_alt");
  });

  it("never alternates while she is NOT speaking", () => {
    expect(resolveAvatar(idleStatus, { alt: true }).state).toBe("idle");
    expect(resolveAvatar(idleStatus, { livePtt: true, alt: true }).state).toBe("listening");
  });

  it("dozes off to the sleeping art with its OWN label when the local idle timer fired", () => {
    const resolved = resolveAvatar(idleStatus, { asleep: true });
    expect(resolved.state).toBe("sleeping");
    expect(resolved.label).toBe(LOCAL_SLEEP_LABEL);
  });

  it("keeps the backend's sleeping (is_ready false = engine not warm) DISTINCT from local doze", () => {
    // Same art, different meaning — the badge must not claim she dozed off when
    // the truth is the engine never warmed up.
    const notReady = resolveAvatar({ ...idleStatus, is_ready: false }, { asleep: false });
    expect(notReady.state).toBe("sleeping");
    expect(notReady.label).not.toBe(LOCAL_SLEEP_LABEL);
  });

  it("ignores the local doze flag unless everything else is idle", () => {
    expect(resolveAvatar({ ...idleStatus, is_processing: true }, { asleep: true }).state).toBe("thinking");
    expect(resolveAvatar(idleStatus, { asleep: true, livePtt: true }).state).toBe("listening");
    expect(resolveAvatar(idleStatus, { asleep: true, liveSpeaking: true }).state).toBe("speaking");
  });
});
