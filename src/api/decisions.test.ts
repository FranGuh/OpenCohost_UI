import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { getDecisions, putDecisions, restartDecisionWorker, type DecisionsResponse } from "./decisions.js";

const sample: DecisionsResponse = {
  decisions: {
    vision: { mode: "shadow", threshold: 0.9 },
    memory: { mode: "shadow", threshold: 0.9 },
    reply_length: { mode: "shadow", threshold: 0.9 },
    respond: { mode: "shadow", threshold: 0.9 }
  },
  worker: { configured: false, state: "unavailable", checkpoint: null, last_error: null },
  budget_ms: 600
};

describe("decisions client", () => {
  it("getDecisions returns the full shape", async () => {
    server.use(http.get(`${API_BASE_URL}/api/decisions`, () => HttpResponse.json(sample)));
    await expect(getDecisions()).resolves.toEqual(sample);
  });

  it("getDecisions throws ApiError on a non-ok status", async () => {
    server.use(http.get(`${API_BASE_URL}/api/decisions`, () => new HttpResponse(null, { status: 500 })));
    await expect(getDecisions()).rejects.toMatchObject({ status: 500 });
  });

  it("putDecisions sends the partial body as JSON and returns the saved shape", async () => {
    const seen: { body: unknown; contentType: string | null }[] = [];
    server.use(
      http.put(`${API_BASE_URL}/api/decisions`, async ({ request }) => {
        seen.push({ body: await request.json(), contentType: request.headers.get("content-type") });
        return HttpResponse.json(sample);
      })
    );
    await expect(putDecisions({ vision: { mode: "on" } })).resolves.toEqual(sample);
    expect(seen).toEqual([{ body: { decisions: { vision: { mode: "on" } } }, contentType: "application/json" }]);
  });

  it("putDecisions throws ApiError carrying the status on 422 and 503", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/decisions`, () =>
        HttpResponse.json({ detail: "invalid_decision_setting" }, { status: 422 })
      )
    );
    await expect(putDecisions({ respond: { mode: "on" } })).rejects.toMatchObject({ status: 422 });
    server.use(
      http.put(`${API_BASE_URL}/api/decisions`, () =>
        HttpResponse.json({ detail: "decision_settings_write_failed" }, { status: 503 })
      )
    );
    await expect(putDecisions({ vision: { threshold: 0.8 } })).rejects.toMatchObject({ status: 503 });
  });

  it("restartDecisionWorker POSTs and returns the worker", async () => {
    const worker = { configured: true, state: "starting", checkpoint: "laya-1", last_error: null };
    let method = "";
    server.use(
      http.post(`${API_BASE_URL}/api/decisions/worker/restart`, ({ request }) => {
        method = request.method;
        return HttpResponse.json(worker);
      })
    );
    await expect(restartDecisionWorker()).resolves.toEqual(worker);
    expect(method).toBe("POST");
  });

  it("restartDecisionWorker throws ApiError on failure", async () => {
    server.use(http.post(`${API_BASE_URL}/api/decisions/worker/restart`, () => new HttpResponse(null, { status: 503 })));
    await expect(restartDecisionWorker()).rejects.toMatchObject({ status: 503 });
  });
});
