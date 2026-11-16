import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError } from "./client.js";
import {
  formatMetric,
  waitForActiveModel,
  getSetupState,
  postInferenceTest,
  putSetupState,
  type InferenceTestResponse,
  type SetupStateResponse
} from "./setup.js";

const pendingState: SetupStateResponse = {
  status: "pending",
  engine_ready: false,
  engine: null,
  show_on_start: true
};

describe("setup state client (GET/PUT /api/setup/state)", () => {
  it("reads the backend setup state as-is", async () => {
    server.use(http.get(`${API_BASE_URL}/api/setup/state`, () => HttpResponse.json(pendingState)));
    await expect(getSetupState()).resolves.toEqual(pendingState);
  });

  it("throws an ApiError carrying the status when the route fails", async () => {
    server.use(http.get(`${API_BASE_URL}/api/setup/state`, () => new HttpResponse(null, { status: 404 })));
    await expect(getSetupState()).rejects.toBeInstanceOf(ApiError);
  });

  it("PUTs only the status and returns the echoed state", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${API_BASE_URL}/api/setup/state`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...pendingState, status: "skipped", show_on_start: false });
      })
    );
    const result = await putSetupState("skipped");
    expect(body).toEqual({ status: "skipped" });
    expect(result.status).toBe("skipped");
    expect(result.show_on_start).toBe(false);
  });
});

describe("inference test client (POST /api/setup/inference-test)", () => {
  const passed: InferenceTestResponse = {
    status: "passed",
    provider: "local",
    model: "qwen3:1.7b",
    metrics: { load_ms: 1200, first_token_ms: 310, tokens_per_second: 41.5 },
    runs: [{ load_ms: 1200, first_token_ms: 400, tokens_per_second: 40, ok: true }],
    error_code: null
  };

  it("returns the cloud failure status and provider message untouched", async () => {
    const failed: InferenceTestResponse = {
      ...passed,
      status: "failed",
      provider: "cloud",
      error_code: "cloud_bad_request",
      http_status: 400,
      provider_message: "Unknown field [INVALID_ARGUMENT]"
    };
    server.use(http.post(`${API_BASE_URL}/api/setup/inference-test`, () => HttpResponse.json(failed)));
    const result = await postInferenceTest(1);
    expect(result.error_code).toBe("cloud_bad_request");
    expect(result.http_status).toBe(400);
    expect(result.provider_message).toBe("Unknown field [INVALID_ARGUMENT]");
  });

  it("sends the run count and returns the verdict untouched", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${API_BASE_URL}/api/setup/inference-test`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(passed);
      })
    );
    await expect(postInferenceTest(3)).resolves.toEqual(passed);
    expect(body).toEqual({ runs: 3 });
  });

  it("throws an ApiError on a non-2xx response", async () => {
    server.use(http.post(`${API_BASE_URL}/api/setup/inference-test`, () => new HttpResponse(null, { status: 503 })));
    await expect(postInferenceTest()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("formatMetric", () => {
  it("renders null as an em dash, never an invented zero", () => {
    expect(formatMetric(null, "ms")).toBe("—");
    expect(formatMetric(null, "tps")).toBe("—");
  });

  it("formats milliseconds as seconds and the response speed as a plain number", () => {
    expect(formatMetric(1234, "ms")).toBe("1.2 s");
    expect(formatMetric(310, "ms")).toBe("0.3 s");
    expect(formatMetric(41.46, "tps")).toBe("41.5");
  });
});

describe("waitForActiveModel (accepted is not applied)", () => {
  function statusSequence(models: string[]) {
    let reads = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => {
        const current = models[Math.min(reads, models.length - 1)];
        reads += 1;
        return HttpResponse.json({ is_ready: true, current_model: current });
      })
    );
    return () => reads;
  }

  it("resolves true only once the engine reports the requested model", async () => {
    const reads = statusSequence(["old", "old", "new"]);
    await expect(waitForActiveModel("new", { intervalMs: 1, timeoutMs: 1000 })).resolves.toBe(true);
    expect(reads()).toBe(3);
  });

  it("resolves false when the engine never converges before the deadline", async () => {
    statusSequence(["old"]);
    await expect(waitForActiveModel("new", { intervalMs: 5, timeoutMs: 30 })).resolves.toBe(false);
  });

  it("stops early when the caller reports a failed switch", async () => {
    const reads = statusSequence(["old"]);
    await expect(waitForActiveModel("new", { intervalMs: 1, timeoutMs: 1000, failed: () => true })).resolves.toBe(false);
    expect(reads()).toBe(0);
  });

  it("keeps polling through a transient status error", async () => {
    let reads = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => {
        reads += 1;
        return reads === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ is_ready: true, current_model: "new" });
      })
    );
    await expect(waitForActiveModel("new", { intervalMs: 1, timeoutMs: 1000 })).resolves.toBe(true);
  });
});
