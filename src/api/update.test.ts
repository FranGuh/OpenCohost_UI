import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { getUpdateStatus, putUpdateConfig } from "./update.js";

describe("update api", () => {
  it("reads the cached check", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/update`, () =>
        HttpResponse.json({ enabled: true, current: "0.5.0a1", latest: "0.5.0-alpha.2", newer: true, url: "https://github.com/plynte-labs/opencohost/releases/tag/v0.5.0-alpha.2" })
      )
    );
    const got = await getUpdateStatus();
    expect(got.newer).toBe(true);
    expect(got.latest).toBe("0.5.0-alpha.2");
  });

  it("saves the switch with a strict boolean body", async () => {
    let body: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/update/config`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ enabled: false });
      })
    );
    expect(await putUpdateConfig(false)).toEqual({ enabled: false });
    expect(body).toEqual({ enabled: false });
  });

  it("throws on a failed read and a failed write", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/update`, () => HttpResponse.json({}, { status: 500 })),
      http.put(`${API_BASE_URL}/api/update/config`, () => HttpResponse.json({ detail: "update_setting_write_failed" }, { status: 503 }))
    );
    await expect(getUpdateStatus()).rejects.toMatchObject({ status: 500 });
    await expect(putUpdateConfig(true)).rejects.toMatchObject({ status: 503 });
  });
});
