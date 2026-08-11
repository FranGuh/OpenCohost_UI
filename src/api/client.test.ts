import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  chatTurnConflictHandler,
  chatTurnQueueFullHandler,
  chatTurnValidationHandler,
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
  DEFAULT_API_BASE_URL,
  NotFoundError,
  QueueFullError,
  ValidationError,
  authFetch,
  bootstrapApiToken,
  getApiBaseUrl,
  getAuthHeaders,
  getMemoriaStats,
  getModels,
  getPerfiles,
  getStatus,
  getTtsConfig,
  postChatTurn,
  postCommand,
  postMemoriaPurge,
  setApiBaseUrl,
  setApiToken,
  switchProfile
} from "./client.js";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}));

describe("client/DEFAULT_API_BASE_URL", () => {
  it("defaults to the real backend port 8765 (run-api.bat), not the dead :8000 fallback that leaves a packaged build silently unresponsive", () => {
    expect(DEFAULT_API_BASE_URL).toBe("http://127.0.0.1:8765");
  });
});

describe("client/setApiBaseUrl", () => {
  it("redirects subsequent requests to the new base URL, and restores the original afterwards", async () => {
    // Capture (not hardcode) the original base URL — it's whatever
    // API_BASE_URL in test/handlers.ts already resolved to, which stays
    // immune to a developer's local .env.local overriding VITE_API_BASE_URL.
    const originalBaseUrl = getApiBaseUrl();
    const REDIRECTED_BASE_URL = "http://127.0.0.1:8770";
    server.use(
      http.get(`${REDIRECTED_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, current_model: "redirected" }))
    );

    setApiBaseUrl(REDIRECTED_BASE_URL);
    try {
      expect(getApiBaseUrl()).toBe(REDIRECTED_BASE_URL);
      const status = await getStatus();
      expect(status.current_model).toBe("redirected");
    } finally {
      // Restore so every other test in this file (and any test that runs
      // after this one in the same process) keeps hitting the original
      // base URL, not this test's override.
      setApiBaseUrl(originalBaseUrl);
    }
    expect(getApiBaseUrl()).toBe(originalBaseUrl);
  });
});

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
  afterEach(() => {
    setApiToken(null);
  });

  it("attaches Authorization header when a token is cached (P4 auth wiring)", async () => {
    setApiToken("op-secret");
    let capturedHeader: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, ({ request }) => {
        capturedHeader = request.headers.get("Authorization");
        return HttpResponse.json({ accepted: true, command_id: "cmd-abc", status: "queued" });
      })
    );

    await switchProfile("Akira", "key-auth");

    expect(capturedHeader).toBe("Bearer op-secret");
  });

  it("sends Idempotency-Key header + {name} body, parses {accepted,command_id,status}", async () => {
    let capturedHeader: string | null = null;
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, async ({ request }) => {
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
  afterEach(() => {
    setApiToken(null);
  });

  it("attaches Authorization header when a token is cached (P4 auth wiring)", async () => {
    setApiToken("op-secret");
    let capturedHeader: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, ({ request }) => {
        capturedHeader = request.headers.get("Authorization");
        return HttpResponse.json({ accepted: true, command_id: "cmd-abc", status: "queued", state_version: 5 });
      })
    );

    await postCommand("switch_model", "gemma4:e4b", "key-auth");

    expect(capturedHeader).toBe("Bearer op-secret");
  });

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

describe("client/postChatTurn", () => {
  afterEach(() => {
    setApiToken(null);
  });

  it("attaches Authorization header when a token is cached (P4 auth wiring)", async () => {
    setApiToken("op-secret");
    let capturedHeader: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, ({ request }) => {
        capturedHeader = request.headers.get("Authorization");
        return HttpResponse.json({ accepted: true, command_id: "cmd-chat", status: "queued", state_version: 3 });
      })
    );

    await postChatTurn("hola", "key-auth");

    expect(capturedHeader).toBe("Bearer op-secret");
  });

  it("sends Idempotency-Key header + {text} body, parses {accepted,command_id,status,state_version} — R8: no reply field", async () => {
    let capturedHeader: string | null = null;
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, async ({ request }) => {
        capturedHeader = request.headers.get("Idempotency-Key");
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-chat", status: "queued", state_version: 3 });
      })
    );

    const result = await postChatTurn("¿Cómo viene el stream?", "key-chat-1");

    expect(capturedHeader).toBe("key-chat-1");
    expect(capturedBody).toEqual({ text: "¿Cómo viene el stream?" });
    expect(result).toEqual({ accepted: true, command_id: "cmd-chat", status: "queued", state_version: 3 });
    expect(result).not.toHaveProperty("reply");
  });

  it("maps 409 to ConflictError", async () => {
    server.use(chatTurnConflictHandler());
    await expect(postChatTurn("hola", "key-409")).rejects.toBeInstanceOf(ConflictError);
  });

  it("maps 429 to QueueFullError", async () => {
    server.use(chatTurnQueueFullHandler());
    await expect(postChatTurn("hola", "key-429")).rejects.toBeInstanceOf(QueueFullError);
  });

  it("maps 422 to ValidationError carrying the backend detail", async () => {
    server.use(chatTurnValidationHandler("text must be non-empty"));
    await expect(postChatTurn("", "key-422")).rejects.toThrow("text must be non-empty");
  });

  it("maps a network error to a rejected promise", async () => {
    server.use(http.post(`${API_BASE_URL}/api/chat/turn`, () => HttpResponse.error()));
    await expect(postChatTurn("hola", "key-network")).rejects.toThrow();
  });

  // Observed live 2026-08-10: the turn reached the engine while the UI sat with
  // the text still in the input and Send permanently greyed, because the POST
  // never settled and `handleSubmit` opens with `if (pending) return`. A hang
  // has to become a normal, retryable rejection.
  //
  // Real time cannot be advanced here — `AbortSignal.timeout` runs on Node's
  // internal timers, which vitest's fake clock does not patch — so the deadline
  // and the mapping are asserted separately: that the request actually CARRIES
  // an armed signal, and that the resulting TimeoutError comes back as a 408.
  it("arms a 15s deadline on the chat turn and reports a timeout as a 408 ApiError", async () => {
    const timeoutArgs: number[] = [];
    const signalsSent: unknown[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeoutArgs.push(ms);
      return new AbortController().signal; // never fires; the fetch stub below decides
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      signalsSent.push((init as RequestInit | undefined)?.signal);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    try {
      await expect(postChatTurn("hola", "key-timeout")).rejects.toMatchObject({
        name: "ApiError",
        status: 408
      });
      expect(timeoutArgs).toEqual([15_000]);
      // Without this the deadline is armed and then thrown away — the hang comes back.
      expect(signalsSent[0]).toBeInstanceOf(AbortSignal);
    } finally {
      fetchSpy.mockRestore();
      timeoutSpy.mockRestore();
    }
  });

  it("lets a non-timeout fetch failure keep its own error, rather than reporting a phantom timeout", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    try {
      await expect(postChatTurn("hola", "key-offline")).rejects.toBeInstanceOf(TypeError);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("treats a 200 with accepted:false as an error, not a successful turn", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/chat/turn`, () =>
        HttpResponse.json({ accepted: false, command_id: "cmd-rejected", status: "rejected" })
      )
    );
    await expect(postChatTurn("hola", "key-rejected")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("client/postMemoriaPurge", () => {
  afterEach(() => {
    setApiToken(null);
  });

  it("attaches Authorization header when a token is cached (P4 auth wiring)", async () => {
    setApiToken("op-secret");
    let capturedHeader: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/memoria/purge`, ({ request }) => {
        capturedHeader = request.headers.get("Authorization");
        return HttpResponse.json({ deleted: 1 });
      })
    );

    await postMemoriaPurge("profile-1");

    expect(capturedHeader).toBe("Bearer op-secret");
  });
});

/**
 * agent_context_gateway Phase 4 (ADR-5): operator token handoff. Owner
 * decision D2 — enforcement stays default OFF, so every one of these must
 * keep an unauthenticated request working exactly as before this track.
 */
describe("client/getAuthHeaders", () => {
  afterEach(() => {
    setApiToken(null);
  });

  it("returns {} when no token is cached (default state — unauthenticated calls keep working, D2)", () => {
    expect(getAuthHeaders()).toEqual({});
  });

  it("returns an Authorization Bearer header once a token is cached", () => {
    setApiToken("op-secret");
    expect(getAuthHeaders()).toEqual({ Authorization: "Bearer op-secret" });
  });
});

describe("client/authFetch", () => {
  afterEach(() => {
    setApiToken(null);
    invokeMock.mockReset();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("attaches Authorization when a token is cached", async () => {
    setApiToken("op-secret");
    let capturedHeader: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/agenda/topic/action`, ({ request }) => {
        capturedHeader = request.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      })
    );

    await authFetch(`${API_BASE_URL}/api/agenda/topic/action`, { method: "POST" });

    expect(capturedHeader).toBe("Bearer op-secret");
  });

  it("sends no Authorization header and the request still succeeds when no token is cached", async () => {
    let capturedHeader: string | null | undefined;
    server.use(
      http.post(`${API_BASE_URL}/api/agenda/topic/action`, ({ request }) => {
        capturedHeader = request.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      })
    );

    const res = await authFetch(`${API_BASE_URL}/api/agenda/topic/action`, { method: "POST" });

    expect(capturedHeader).toBeNull();
    expect(res.ok).toBe(true);
  });

  it("re-invokes api_token once on a 401 and retries with the refreshed token (spawn-path race)", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValueOnce("refreshed-token");
    let attempts = 0;
    let secondAttemptHeader: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/agenda/topic/action`, ({ request }) => {
        attempts += 1;
        if (attempts === 1) {
          return new HttpResponse(null, { status: 401 });
        }
        secondAttemptHeader = request.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      })
    );

    const res = await authFetch(`${API_BASE_URL}/api/agenda/topic/action`, { method: "POST" });

    expect(invokeMock).toHaveBeenCalledWith("api_token");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
    expect(secondAttemptHeader).toBe("Bearer refreshed-token");
    expect(res.ok).toBe(true);
  });

  it("outside the Tauri shell, a 401 is returned as-is (no invoke, no retry loop)", async () => {
    let attempts = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/agenda/topic/action`, () => {
        attempts += 1;
        return new HttpResponse(null, { status: 401 });
      })
    );

    const res = await authFetch(`${API_BASE_URL}/api/agenda/topic/action`, { method: "POST" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(attempts).toBe(1);
    expect(res.status).toBe(401);
  });
});

describe("client/bootstrapApiToken", () => {
  afterEach(() => {
    setApiToken(null);
    invokeMock.mockReset();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("caches the token returned by the api_token command", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValueOnce("bootstrapped-token");

    await bootstrapApiToken();

    expect(getAuthHeaders()).toEqual({ Authorization: "Bearer bootstrapped-token" });
  });

  it("never throws when invoke fails, leaving the cache empty", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    invokeMock.mockRejectedValueOnce(new Error("no such command"));

    await expect(bootstrapApiToken()).resolves.toBeUndefined();
    expect(getAuthHeaders()).toEqual({});
  });

  it("is a no-op outside the Tauri shell", async () => {
    await bootstrapApiToken();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(getAuthHeaders()).toEqual({});
  });
});
