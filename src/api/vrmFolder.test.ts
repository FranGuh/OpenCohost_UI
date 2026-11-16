import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { deleteVrmFolder, getVrmFolder, putVrmFolder, VrmFolderError } from "./avatar.js";
import { middleTruncate } from "../lib/middleTruncate.js";

describe("VRM folder API", () => {
  it("reads the current folder", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/avatar/vrm/folder`, () =>
        HttpResponse.json({ path: "C:\\m", source: "env", exists: true, model_count: 2 })
      )
    );
    expect(await getVrmFolder()).toEqual({ path: "C:\\m", source: "env", exists: true, model_count: 2 });
  });

  it("PUTs the chosen path as JSON", async () => {
    let body: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/vrm/folder`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ path: "C:\\m", source: "saved", exists: true, model_count: 0 });
      })
    );
    const out = await putVrmFolder("C:\\m");
    expect(body).toEqual({ path: "C:\\m" });
    expect(out.source).toBe("saved");
  });

  it("throws a VrmFolderError carrying the stable code", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/avatar/vrm/folder`, () =>
        HttpResponse.json({ detail: "path_not_found" }, { status: 422 })
      )
    );
    await expect(putVrmFolder("C:\\nope")).rejects.toMatchObject({
      name: "VrmFolderError",
      code: "path_not_found"
    });
    expect(new VrmFolderError("x", 422).code).toBe("x");
  });

  it("DELETE resets", async () => {
    server.use(
      http.delete(`${API_BASE_URL}/api/avatar/vrm/folder`, () =>
        HttpResponse.json({ path: "C:\\d", source: "default", exists: true, model_count: 0 })
      )
    );
    expect((await deleteVrmFolder()).source).toBe("default");
  });
});

describe("middleTruncate", () => {
  it("keeps short text", () => {
    expect(middleTruncate("C:\\a", 20)).toBe("C:\\a");
  });
  it("keeps both ends of a long path within the limit", () => {
    const out = middleTruncate("C:\\Users\\someone\\Documents\\Avatares\\Modelos", 24);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out.startsWith("C:\\Use")).toBe(true);
    expect(out.endsWith("Modelos")).toBe(true);
    expect(out).toContain("…");
  });
});
