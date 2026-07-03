import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  defaultProfiles,
  defaultStatus,
  switchConflictHandler,
  switchNotFoundHandler,
  switchQueueFullHandler
} from "../test/handlers.js";
import {
  ApiError,
  ConflictError,
  NotFoundError,
  QueueFullError,
  getPerfiles,
  getStatus,
  switchProfile
} from "./client.js";

describe("client/getStatus", () => {
  it("parses is_ready/current_model/is_speaking/is_processing/active_profile/health/state_version", async () => {
    const status = await getStatus();
    expect(status).toEqual(defaultStatus);
  });
});

describe("client/getPerfiles", () => {
  it("parses the profile list from the generated types (no hardcoded shape)", async () => {
    const perfiles = await getPerfiles();
    expect(perfiles).toEqual(defaultProfiles);
  });
});

describe("client/switchProfile", () => {
  it("sends Idempotency-Key header + {name} body, parses {accepted,command_id,status}", async () => {
    let capturedHeader: string | null = null;
    let capturedBody: unknown;
    server.use(
      http.post("http://127.0.0.1:8000/api/perfiles/switch", async ({ request }) => {
        capturedHeader = request.headers.get("Idempotency-Key");
        capturedBody = await request.json();
        return HttpResponse.json({
          accepted: true,
          command_id: "cmd-abc",
          status: "queued"
        });
      })
    );

    const result = await switchProfile("Akira", "key-123");

    expect(capturedHeader).toBe("key-123");
    expect(capturedBody).toEqual({ name: "Akira" });
    expect(result).toEqual({ accepted: true, command_id: "cmd-abc", status: "queued" });
  });

  it("maps 429 to QueueFullError", async () => {
    server.use(switchQueueFullHandler());
    await expect(switchProfile("Akira", "key-429")).rejects.toBeInstanceOf(QueueFullError);
  });

  it("maps 409 to ConflictError", async () => {
    server.use(switchConflictHandler());
    await expect(switchProfile("Akira", "key-409")).rejects.toBeInstanceOf(ConflictError);
  });

  it("maps 404 to NotFoundError", async () => {
    server.use(switchNotFoundHandler());
    await expect(switchProfile("ghost", "key-404")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps a 404 with a non-JSON body to NotFoundError instead of an opaque SyntaxError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () => new HttpResponse("not json", { status: 404 }))
    );
    await expect(switchProfile("ghost", "key-404-nonjson")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("treats a 200 with accepted:false as an error, not a successful switch", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
        HttpResponse.json({ accepted: false, command_id: "cmd-rejected", status: "rejected" })
      )
    );
    await expect(switchProfile("Akira", "key-rejected")).rejects.toBeInstanceOf(ApiError);
  });
});
