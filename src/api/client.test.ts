import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  commandConflictHandler,
  commandQueueFullHandler,
  commandValidationHandler,
  defaultMemoriaStats,
  defaultModels,
  defaultProfiles,
  defaultStatus,
  defaultTtsConfig,
  switchConflictHandler,
  switchNotFoundHandler,
  switchQueueFullHandler
} from "../test/handlers.js";
import {
  ApiError,
  ConflictError,
  NotFoundError,
  QueueFullError,
  ValidationError,
  getMemoriaStats,
  getModels,
  getPerfiles,
  getStatus,
  getTtsConfig,
  postCommand,
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

describe("client/getModels", () => {
  it("parses catalog/discovered/current_model/tiers/active_tier from the generated types", async () => {
    const models = await getModels();
    expect(models).toEqual(defaultModels);
  });
});

describe("client/getTtsConfig", () => {
  it("parses piper_voice/local_only/speed/engine/heavy_available", async () => {
    const config = await getTtsConfig();
    expect(config).toEqual(defaultTtsConfig);
  });
});

describe("client/getMemoriaStats", () => {
  it("parses counts-only fields, no chat content", async () => {
    const stats = await getMemoriaStats();
    expect(stats).toEqual(defaultMemoriaStats);
  });
});

describe("client/postCommand", () => {
  it("sends Idempotency-Key header + {command, payload:{value}} body, parses {accepted,command_id,status,state_version}", async () => {
    let capturedHeader: string | null = null;
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedHeader = request.headers.get("Idempotency-Key");
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-abc", status: "queued", state_version: 5 });
      })
    );

    const result = await postCommand("switch_model", "gemma4:e4b", "key-123");

    expect(capturedHeader).toBe("key-123");
    expect(capturedBody).toEqual({ command: "switch_model", payload: { value: "gemma4:e4b" } });
    expect(result).toEqual({ accepted: true, command_id: "cmd-abc", status: "queued", state_version: 5 });
  });

  it("sends clear_history with an empty payload (no value key)", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-clear", status: "queued", state_version: 6 });
      })
    );

    await postCommand("clear_history", undefined, "key-clear");

    expect(capturedBody).toEqual({ command: "clear_history", payload: {} });
  });

  it("maps 409 to ConflictError", async () => {
    server.use(commandConflictHandler());
    await expect(postCommand("switch_model", "x", "key-409")).rejects.toBeInstanceOf(ConflictError);
  });

  it("maps 429 to QueueFullError", async () => {
    server.use(commandQueueFullHandler());
    await expect(postCommand("switch_model", "x", "key-429")).rejects.toBeInstanceOf(QueueFullError);
  });

  it("maps 422 to ValidationError carrying the backend detail", async () => {
    server.use(commandValidationHandler("set_tts_speed requires a numeric value"));
    await expect(postCommand("set_tts_speed", null, "key-422")).rejects.toBeInstanceOf(ValidationError);
    server.use(commandValidationHandler("set_tts_speed requires a numeric value"));
    await expect(postCommand("set_tts_speed", null, "key-422b")).rejects.toThrow(
      "set_tts_speed requires a numeric value"
    );
  });

  it("treats a 200 with accepted:false as an error, not a successful command", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () =>
        HttpResponse.json({ accepted: false, command_id: "cmd-rejected", status: "rejected" })
      )
    );
    await expect(postCommand("switch_model", "x", "key-rejected")).rejects.toBeInstanceOf(ApiError);
  });
});
