import { http, HttpResponse } from "msw";
import type { paths } from "../api/types.gen.js";

export const API_BASE_URL = "http://127.0.0.1:8000";

type StatusResponse = paths["/api/status"]["get"]["responses"][200]["content"]["application/json"];
type ProfilesResponse = paths["/api/perfiles"]["get"]["responses"][200]["content"]["application/json"];

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

export const handlers = [
  http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json(defaultStatus)),
  http.get(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json(defaultProfiles)),
  http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
    HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued" })
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
