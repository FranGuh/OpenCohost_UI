import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  defaultProfiles,
  defaultStatus,
  switchConflictHandler,
  switchNotFoundHandler,
  switchQueueFullHandler
} from "../test/handlers.js";
import { ConflictError, NotFoundError, QueueFullError, getPerfiles, getStatus, switchProfile } from "./client.js";

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
});
