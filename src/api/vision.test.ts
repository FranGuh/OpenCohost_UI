import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError } from "./client.js";
import {
  VisionDisabledError,
  VisionValidationError,
  ThumbnailUnavailableError,
  getVision,
  getVisionThumbnails,
  lookNow,
  putVision,
  type VisionResponse,
  visionReadiness,
  visionReasonKey
} from "./vision.js";

const VISION: VisionResponse = {
  enabled: true,
  look_on_ptt: false,
  capture_delay_s: 1,
  rule_gate_enabled: false,
  model: "qwen3-vl:4b-instruct",
  port: 11435,
  describe_timeout_s: 8,
  status: { daemon_state: "running", model_installed: true, capture_available: true, armed: false, looking: false }
};

describe("vision client", () => {
  it("getVision returns settings and status", async () => {
    server.use(http.get(`${API_BASE_URL}/api/vision`, () => HttpResponse.json(VISION)));
    await expect(getVision()).resolves.toEqual(VISION);
  });

  it("getVision throws ApiError on a non-ok status", async () => {
    server.use(http.get(`${API_BASE_URL}/api/vision`, () => new HttpResponse(null, { status: 503 })));
    await expect(getVision()).rejects.toMatchObject({ status: 503 });
  });

  it("putVision sends only the partial update as JSON", async () => {
    const seen: { body: unknown; contentType: string | null }[] = [];
    server.use(
      http.put(`${API_BASE_URL}/api/vision`, async ({ request }) => {
        seen.push({ body: await request.json(), contentType: request.headers.get("content-type") });
        return HttpResponse.json({ ...VISION, look_on_ptt: true });
      })
    );
    await expect(putVision({ look_on_ptt: true })).resolves.toMatchObject({ look_on_ptt: true });
    expect(seen[0].body).toEqual({ look_on_ptt: true });
    expect(seen[0].contentType).toContain("application/json");
  });

  it("maps a 422 to VisionValidationError carrying errors[]", async () => {
    const errors = [{ field: "capture_delay_s", code: "invalid_value" }];
    server.use(
      http.put(`${API_BASE_URL}/api/vision`, () =>
        HttpResponse.json({ detail: "invalid_vision_settings", errors }, { status: 422 })
      )
    );
    const failure = await putVision({ capture_delay_s: 99 }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(VisionValidationError);
    expect((failure as VisionValidationError).errors).toEqual(errors);
  });

  it("maps a 503 on PUT to a plain ApiError (write failed)", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/vision`, () => HttpResponse.json({ detail: "vision_write_failed" }, { status: 503 }))
    );
    const failure = await putVision({ enabled: true }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).not.toBeInstanceOf(VisionValidationError);
    expect(failure).toMatchObject({ status: 503 });
  });

  it("lookNow posts and returns {armed}", async () => {
    server.use(http.post(`${API_BASE_URL}/api/vision/look`, () => HttpResponse.json({ armed: true })));
    await expect(lookNow()).resolves.toEqual({ armed: true });
  });

  it("lookNow sends the mode only when one is given", async () => {
    const bodies: string[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/vision/look`, async ({ request }) => {
        bodies.push(await request.text());
        return HttpResponse.json({ armed: true });
      })
    );
    await lookNow("clip");
    await lookNow();
    expect(JSON.parse(bodies[0])).toEqual({ mode: "clip" });
    expect(bodies[1]).toBe("");
  });

  it("lookNow maps 409 to VisionDisabledError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/vision/look`, () => HttpResponse.json({ detail: "vision_disabled" }, { status: 409 }))
    );
    await expect(lookNow()).rejects.toBeInstanceOf(VisionDisabledError);
  });
});


function resp(enabled: boolean, status: Partial<VisionResponse["status"]>): VisionResponse {
  return {
    enabled,
    look_on_ptt: false,
    capture_delay_s: 0,
    rule_gate_enabled: false,
    model: "m",
    port: 1,
    describe_timeout_s: 8,
    status: { daemon_state: "running", model_installed: true, capture_available: true, armed: false, looking: false, ...status }
  };
}

describe("visionReadiness", () => {
  it("is off when disabled, whatever the daemon says", () => {
    expect(visionReadiness(resp(false, { state: "ready" }))).toBe("off");
  });
  it("uses the backend state when present", () => {
    for (const s of ["starting", "warming", "ready", "failed"] as const) {
      expect(visionReadiness(resp(true, { state: s }))).toBe(s);
    }
  });
  it("derives from daemon_state for an older backend", () => {
    expect(visionReadiness(resp(true, { daemon_state: "running" }))).toBe("ready");
    expect(visionReadiness(resp(true, { daemon_state: "starting" }))).toBe("starting");
  });
  it("is unknown (undefined data) before the first response", () => {
    expect(visionReadiness(undefined)).toBe("off");
  });
});

describe("visionReasonKey", () => {
  it("maps known outcome codes and falls back for unknown ones", () => {
    expect(visionReasonKey("describe_timeout")).toBe("experiencia.vision.reason.describe_timeout");
    expect(visionReasonKey("something_new")).toBe("experiencia.vision.reason.unknown");
    expect(visionReasonKey(null)).toBe("experiencia.vision.reason.unknown");
  });
});

describe("getVisionThumbnails", () => {
  it("returns the data-URL frames for a look id", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/vision/looks/abc/thumbnails`, () =>
        HttpResponse.json({ id: "abc", thumbnails: ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"] })
      )
    );
    await expect(getVisionThumbnails("abc")).resolves.toEqual(["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"]);
  });

  it("url-encodes the id", async () => {
    let seen = "";
    server.use(
      http.get(`${API_BASE_URL}/api/vision/looks/:id/thumbnails`, ({ params }) => {
        seen = String(params.id);
        return HttpResponse.json({ id: seen, thumbnails: [] });
      })
    );
    await getVisionThumbnails("a/b c");
    expect(seen).toBe("a/b c");
  });

  it("maps 404 to ThumbnailUnavailableError", async () => {
    server.use(http.get(`${API_BASE_URL}/api/vision/looks/gone/thumbnails`, () => new HttpResponse(null, { status: 404 })));
    await expect(getVisionThumbnails("gone")).rejects.toBeInstanceOf(ThumbnailUnavailableError);
  });

  it("maps other failures to ApiError", async () => {
    server.use(http.get(`${API_BASE_URL}/api/vision/looks/x/thumbnails`, () => new HttpResponse(null, { status: 500 })));
    const failure = await getVisionThumbnails("x").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).not.toBeInstanceOf(ThumbnailUnavailableError);
  });
});

describe("visionReasonKey self_capture", () => {
  it("has its own friendly copy", () => {
    expect(visionReasonKey("self_capture")).toBe("experiencia.vision.reason.self_capture");
  });
});
