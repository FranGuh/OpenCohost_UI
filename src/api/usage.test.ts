import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError, NotFoundError } from "./client.js";
import { downloadUsageExport, getUsageSummary, postUsagePurge } from "./usage.js";

const summary = {
  from: "2025-11-10",
  to: "2026-11-09",
  enabled: true,
  first_recorded: "2026-11-09",
  days: [],
  by_model: [],
  by_kind: [],
  by_source: [],
  by_profile: [],
  cache: { estimated_reused_tokens: 0, real_available: false, real_prompt_tokens: null, real_reused_tokens: null },
  decisions: []
};

describe("usage api", () => {
  it("getUsageSummary returns the summary JSON", async () => {
    server.use(http.get(`${API_BASE_URL}/api/usage/summary`, () => HttpResponse.json(summary)));
    await expect(getUsageSummary()).resolves.toEqual(summary);
  });

  it("getUsageSummary maps 404 to NotFoundError (old backend)", async () => {
    server.use(http.get(`${API_BASE_URL}/api/usage/summary`, () => new HttpResponse(null, { status: 404 })));
    await expect(getUsageSummary()).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getUsageSummary maps other failures to ApiError with the status", async () => {
    server.use(http.get(`${API_BASE_URL}/api/usage/summary`, () => new HttpResponse(null, { status: 500 })));
    await expect(getUsageSummary()).rejects.toMatchObject({ status: 500 });
    await expect(getUsageSummary()).rejects.toBeInstanceOf(ApiError);
  });

  it("downloadUsageExport requests the format and returns the blob", async () => {
    let seen = "";
    server.use(
      http.get(`${API_BASE_URL}/api/usage/export`, ({ request }) => {
        seen = new URL(request.url).searchParams.get("format") ?? "";
        return new HttpResponse("date,calls\n", { headers: { "Content-Type": "text/csv" } });
      })
    );
    const blob = await downloadUsageExport("csv");
    expect(seen).toBe("csv");
    expect(await blob.text()).toBe("date,calls\n");
  });

  it("postUsagePurge posts the DELETE_USAGE confirmation", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${API_BASE_URL}/api/usage/purge`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ deleted: true });
      })
    );
    await expect(postUsagePurge()).resolves.toEqual({ deleted: true });
    expect(body).toEqual({ confirm: "DELETE_USAGE" });
  });
});
