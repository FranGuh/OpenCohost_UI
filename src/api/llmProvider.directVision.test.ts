import { describe, expect, it } from "vitest";
import { LLM_PROVIDER_PRESETS, directVisionAvailability, type LlmProviderResponse } from "./llmProvider.js";

function cfg(active: string, profile?: Record<string, unknown>): LlmProviderResponse {
  return {
    active_provider: active,
    fallback_mode: "auto",
    pregen_enabled: false,
    discard_stale_speech_on_regenerated_reply: false,
    profiles: profile ? { p: { base_url: "https://x", model: "", preset: "", api_key_set: true, ...profile } as never } : {}
  };
}

describe("directVisionAvailability", () => {
  it("is unavailable without data or on the local provider", () => {
    expect(directVisionAvailability(undefined, LLM_PROVIDER_PRESETS)).toBe("local");
    expect(directVisionAvailability(cfg("local"), LLM_PROVIDER_PRESETS)).toBe("local");
  });

  it("follows the preset model's vision flag", () => {
    expect(directVisionAvailability(cfg("p", { preset: "gemini", model: "gemini-3.5-flash-lite" }), LLM_PROVIDER_PRESETS)).toBe("ok");
    expect(directVisionAvailability(cfg("p", { preset: "deepseek", model: "deepseek-v4-pro" }), LLM_PROVIDER_PRESETS)).toBe("no_vision");
  });

  it("uses the profile's own model_vision flag for custom models", () => {
    expect(directVisionAvailability(cfg("p", { model: "mine" }), LLM_PROVIDER_PRESETS)).toBe("no_vision");
    expect(directVisionAvailability(cfg("p", { model: "mine", model_vision: true }), LLM_PROVIDER_PRESETS)).toBe("ok");
    expect(directVisionAvailability(cfg("p", { preset: "openrouter", model: "x/y" }), LLM_PROVIDER_PRESETS)).toBe("no_vision");
  });
});
