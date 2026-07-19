import { describe, expect, it } from "vitest";
import { ApiError, ConflictError, ValidationError } from "../../api/client.js";
import type { StreamChatLiveResponse } from "../../api/stream.js";
import {
  COOLDOWN_WIRE,
  FILTER_POLICY,
  REACCIONES_WIRE,
  describeStreamLimits,
  errorCopy,
  toStreamLimits
} from "./wire.js";

const streamBase: StreamChatLiveResponse = {
  connected: false,
  platform: null,
  source_id: null,
  threshold_per_second: 1,
  cooldown_seconds: 45,
  max_messages_per_user: 10,
  filter_policy: "balanced"
};

describe("/acciones vocab tables (R22/R23/R25)", () => {
  it("REACCIONES_WIRE maps bajo/medio/alto → 1/3/5", () => {
    expect(REACCIONES_WIRE.bajo).toBe(1);
    expect(REACCIONES_WIRE.medio).toBe(3);
    expect(REACCIONES_WIRE.alto).toBe(5);
  });

  it("COOLDOWN_WIRE maps bajo/medio/alto → 20/45/90", () => {
    expect(COOLDOWN_WIRE.bajo).toBe(20);
    expect(COOLDOWN_WIRE.medio).toBe(45);
    expect(COOLDOWN_WIRE.alto).toBe(90);
  });

  it("FILTER_POLICY maps the 3 presets to themselves (wire value === UI value)", () => {
    expect(FILTER_POLICY.balanced).toBe("balanced");
    expect(FILTER_POLICY.twitch_relaxed).toBe("twitch_relaxed");
    expect(FILTER_POLICY.strict).toBe("strict");
  });
});

describe("toStreamLimits (R22-R25)", () => {
  it("builds the StreamLimitsRequest from UI values, casting spam to int", () => {
    expect(
      toStreamLimits({ reacciones: "alto", cooldown: "bajo", spam: "20", input_contract: "strict" })
    ).toEqual({
      threshold_per_second: 5,
      cooldown_seconds: 20,
      max_messages_per_user: 20,
      filter_policy: "strict"
    });
  });

  it("maps the step defaults to their canonical wire values", () => {
    expect(
      toStreamLimits({ reacciones: "medio", cooldown: "medio", spam: "10", input_contract: "balanced" })
    ).toEqual({
      threshold_per_second: 3,
      cooldown_seconds: 45,
      max_messages_per_user: 10,
      filter_policy: "balanced"
    });
  });
});

describe("describeStreamLimits (R26)", () => {
  it("connected → applied-immediately copy", () => {
    expect(describeStreamLimits({ ...streamBase, connected: true })).toMatch(/se aplicó al chat en vivo/i);
  });

  it("not connected → saved-as-defaults copy", () => {
    expect(describeStreamLimits({ ...streamBase, connected: false })).toMatch(/próxima vez que conectes/i);
  });
});

describe("errorCopy (D5)", () => {
  it("ValidationError surfaces the backend detail", () => {
    expect(errorCopy(new ValidationError("invalid_filter_policy"))).toContain("invalid_filter_policy");
  });

  it("ConflictError → busy copy", () => {
    expect(errorCopy(new ConflictError("busy"))).toMatch(/en curso/i);
  });

  it("generic ApiError → status-tagged retry copy", () => {
    expect(errorCopy(new ApiError("boom", 503))).toMatch(/503/);
  });

  it("unknown/network error → generic retry copy", () => {
    expect(errorCopy(new Error("offline"))).toMatch(/probá de nuevo/i);
  });
});
