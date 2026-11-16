import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { setApiToken } from "./client.js";
import { getTavilySettings, putTavilySettings } from "./webFetch.js";

const status = { api_key_set: true, stored_key_set: true, source: "keyring", storage_available: true };
const canary = "tvly-UI-CANARY-not-real";

beforeEach(() => setApiToken("test-operator"));
afterEach(() => setApiToken(null));

describe("write-only Tavily settings client", () => {
  it("returns only redacted status and sends the key only in PUT", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/web-fetch/tavily`, ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer test-operator");
        return HttpResponse.json({ ...status, api_key: canary });
      }),
      http.put(`${API_BASE_URL}/api/web-fetch/tavily`, async ({ request }) => {
        expect(request.headers.get("Authorization")).toBe("Bearer test-operator");
        expect(await request.json()).toEqual({ api_key: canary });
        return HttpResponse.json(status);
      })
    );
    expect(await getTavilySettings()).toEqual(status);
    const body = { api_key: canary };
    expect(await putTavilySettings(body)).toEqual(status);
    expect(JSON.stringify(body)).not.toContain(canary);
  });

  it("maps errors generically and scrubs failed request references", async () => {
    server.use(http.put(`${API_BASE_URL}/api/web-fetch/tavily`, () => HttpResponse.json({ detail: canary }, { status: 503 })));
    const body = { api_key: canary };
    await expect(putTavilySettings(body)).rejects.toThrow("tavily_setting_failed");
    expect(JSON.stringify(body)).not.toContain(canary);
  });
});
