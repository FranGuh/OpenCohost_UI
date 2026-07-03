import { http, HttpResponse } from "msw";
import type { paths } from "../api/types.gen.js";

export const API_BASE_URL = "http://127.0.0.1:8000";

type StatusResponse = paths["/api/status"]["get"]["responses"][200]["content"]["application/json"];
type ProfilesResponse = paths["/api/perfiles"]["get"]["responses"][200]["content"]["application/json"];
type ModelsResponse = paths["/api/models"]["get"]["responses"][200]["content"]["application/json"];
type TtsConfigResponse = paths["/api/tts/config"]["get"]["responses"][200]["content"]["application/json"];
type MemoriaStatsResponse = paths["/api/memoria/stats"]["get"]["responses"][200]["content"]["application/json"];

export const defaultStatus: StatusResponse = {
  is_ready: true,
  current_model: "qwen3-tts",
  is_speaking: false,
  is_processing: false,
  active_profile: "default",
  health: {
    vram_status: "ok",
    rtf_status: "ok",
    ollama_status: "ok",
    qwen_status: "ok",
    overall_status: "ok",
    ollama_lifecycle: "running",
    qwen_lifecycle: "running",
    free_vram_mb: 4096,
    rtf_rolling_avg: 0.3,
    last_updated: 0
  },
  state_version: 1
};

export const defaultProfiles: ProfilesResponse = { profiles: ["default", "Akira"] };

export const defaultModels: ModelsResponse = {
  catalog: {
    "qwen3:1.7b": { display: "Qwen 3 (1.7B) ⚡", desc: "Ultra rápido.", size_gb: 1.1, family: "qwen3" },
    "llama3.2:3b": { display: "LLaMA 3.2 (3B)", desc: "Español nativo.", size_gb: 2.0, family: "llama" },
    "gemma4:e4b": { display: "Gemma 4 (E4B)", desc: "Más calidad.", size_gb: 2.5, family: "gemma" }
  },
  discovered: ["qwen3:1.7b"],
  current_model: "qwen3:1.7b",
  tiers: { quality: "gemma4:e4b", balanced: "llama3.2:3b", fast: "qwen3:1.7b" },
  active_tier: "fast"
};

export const defaultTtsConfig: TtsConfigResponse = {
  piper_voice: "argentina",
  local_only: true,
  speed: 1.15,
  engine: "ligero",
  heavy_available: false
};

export const defaultMemoriaStats: MemoriaStatsResponse = {
  session_turns: 14,
  digest_entries: 3,
  saved_memorias: 7,
  pinned: 5,
  editorial_cards_by_status: { draft: 1, published: 0, archived: 2 }
};

export const handlers = [
  http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(defaultStatus)),
  http.get(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json(defaultProfiles)),
  http.get(`${API_BASE_URL}/api/models`, () => HttpResponse.json(defaultModels)),
  http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json(defaultTtsConfig)),
  http.get(`${API_BASE_URL}/api/memoria/stats`, () => HttpResponse.json(defaultMemoriaStats)),
  http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued" })
  ),
  http.post(`${API_BASE_URL}/api/commands`, () =>
    HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 })
  )
];

/** Per-test override: switch rejected with 409 conflict. */
export function switchConflictHandler() {
  return http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: false, reason: "conflict" }, { status: 409 })
  );
}

/** Per-test override: switch rejected with 429 queue_full. */
export function switchQueueFullHandler() {
  return http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: false, reason: "queue_full" }, { status: 429 })
  );
}

/** Per-test override: switch rejected with 404 unknown profile. */
export function switchNotFoundHandler() {
  return http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ detail: "profile not found" }, { status: 404 })
  );
}

/**
 * Per-test override: same Idempotency-Key always replays the same command_id
 * (backend dedupe), asserting the client never treats a replay as a new apply.
 */
export function switchReplayHandler(commandId: string) {
  return http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: true, command_id: commandId, status: "queued" })
  );
}

/** Per-test override: POST /api/commands rejected with 409 conflict. */
export function commandConflictHandler() {
  return http.post(`${API_BASE_URL}/api/commands`, () =>
    HttpResponse.json({ accepted: false, reason: "conflict" }, { status: 409 })
  );
}

/** Per-test override: POST /api/commands rejected with 429 queue_full. */
export function commandQueueFullHandler() {
  return http.post(`${API_BASE_URL}/api/commands`, () =>
    HttpResponse.json({ accepted: false, reason: "queue_full" }, { status: 429 })
  );
}

/** Per-test override: POST /api/commands rejected with 422 (invalid value/unknown command). */
export function commandValidationHandler(detail = "invalid command") {
  return http.post(`${API_BASE_URL}/api/commands`, () => HttpResponse.json({ detail }, { status: 422 }));
}

/** Per-test override: POST /api/commands fails at the network level (no response at all). */
export function commandNetworkErrorHandler() {
  return http.post(`${API_BASE_URL}/api/commands`, () => HttpResponse.error());
}

/**
 * Single-dispatcher command stub — reproduces the REAL backend's
 * state_version semantics (judgment-day HIGH #1/#2 root cause): GET
 * /api/status and POST /api/commands share ONE counter, bumped ONLY at
 * ENQUEUE/accept time. GET /api/status just reads the counter back — it
 * never advances again just because the engine finished applying a
 * command. Any convergence logic that waits for
 * `GET.state_version > accepted.state_version` (the accept-time baseline)
 * can NEVER converge against this stub, because that comparison is always
 * `N > N`. Use this (instead of a hand-rolled 200 for POST /api/commands)
 * whenever a test needs an honest accepted -> poll cycle for a command with
 * no real "applied" field to observe.
 */
export function commandDispatcherHandlers(initial: Partial<StatusResponse> = {}) {
  let status: StatusResponse = { ...defaultStatus, ...initial };
  return [
    http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(status)),
    http.post(`${API_BASE_URL}/api/commands`, () => {
      status = { ...status, state_version: status.state_version + 1 };
      return HttpResponse.json({
        accepted: true,
        command_id: `cmd-${status.state_version}`,
        status: "queued",
        state_version: status.state_version
      });
    })
  ];
}

/**
 * GET /api/status pinned to a fixed `state_version` forever — the "GET
 * never independently advances state_version" half of the single-dispatcher
 * contract above, for tests that supply their own POST /api/commands
 * handler (e.g. to capture headers/body) and just need GET to stay honest
 * about not being an applied signal.
 */
export function frozenStatusHandler(stateVersion: number, overrides: Partial<StatusResponse> = {}) {
  return http.get(`${API_BASE_URL}/api/status`, () =>
    HttpResponse.json({ ...defaultStatus, ...overrides, state_version: stateVersion })
  );
}

/**
 * GET /api/status that never converges no matter how long a test polls it —
 * `current_model` (and everything else) stays frozen at `defaultStatus`.
 * Used to exercise the soft APPLY_TIMEOUT_MS ceiling for `matches`-based
 * commands (e.g. switch_model) whose real applied field never flips.
 */
export function neverConvergesStatusHandler() {
  return http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(defaultStatus));
}

/**
 * Per-test override simulating the ~2s accepted-to-applied lag: `GET /api/status`
 * keeps returning `oldProfile` for `flipAfterCalls` requests, then flips to
 * `newProfile` on every call after that.
 */
export function evolvingStatusHandler(oldProfile: string, newProfile: string, flipAfterCalls: number) {
  let calls = 0;
  return http.get(`${API_BASE_URL}/api/status`, () => {
    calls += 1;
    return HttpResponse.json({
      ...defaultStatus,
      active_profile: calls > flipAfterCalls ? newProfile : oldProfile
    });
  });
}

/** Per-test override: GET /api/status's current_model flips after N calls (switch_model convergence). */
export function evolvingCurrentModelHandler(oldModel: string, newModel: string, flipAfterCalls: number) {
  let calls = 0;
  return http.get(`${API_BASE_URL}/api/status`, () => {
    calls += 1;
    return HttpResponse.json({
      ...defaultStatus,
      current_model: calls > flipAfterCalls ? newModel : oldModel
    });
  });
}
