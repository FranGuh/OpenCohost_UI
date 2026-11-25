import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, NotFoundError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";
import { MODELS_QUERY_KEY } from "./models.js";

/**
 * GET/PUT /api/llm/provider (multi_provider_llm_20260723 — design.md
 * "Provider Config Surface" + "GET/PUT /api/llm/provider schema"). Hand-typed
 * 1:1 with opencohost/api/models.py::LlmProviderResponse / LlmProviderRequest
 * (no generated type yet — same snapshot-lag pattern as ObsConfigResponse).
 *
 * SECRET (design "Keys"): `api_key` is WRITE-ONLY. The response NEVER carries a
 * key — only a per-profile `api_key_set` boolean. The key transits the PUT
 * request body only: it never enters the query cache, a query key, or a log.
 * TanStack also retains `mutation.state.variables` (the request body) on the
 * MutationCache for ~gcTime after settle — `useUpdateLlmProvider`'s
 * `onSettled` scrubs `api_key` off that retained object in place so it
 * doesn't linger there either.
 * ponytail: keep in sync manually if those models change.
 */
export interface LlmProviderProfile {
  base_url: string;
  model: string;
  preset: string;
  /** The owner ticked "this model sees images" (custom models). Absent on an older backend. */
  model_vision?: boolean;
  /** True when a key is stored for THIS profile id (OAuthStore). The key
   * itself is never returned — this bool is the only signal. */
  api_key_set: boolean;
}

export interface LlmProviderResponse {
  /** "local" (Ollama) or a configured profile id. */
  active_provider: string;
  fallback_mode: "auto" | "manual";
  pregen_enabled: boolean;
  /** T4 (live_session_fixes_20260925): "discard stale speech when a
   * regenerated reply arrives" -- default false (today's behavior,
   * byte-identical). See ProviderCard's "Al llegar la respuesta" toggle. */
  discard_stale_speech_on_regenerated_reply: boolean;
  /** id → non-secret profile fields. Keyed by profile id (`openai`, `nvidia_nim`, custom). */
  profiles: Record<string, LlmProviderProfile>;
}

/**
 * PUT body — every field optional; omitted fields keep their stored value.
 * Profile-scoped fields (`base_url`/`model`/`preset`/`api_key`) are a partial
 * merge into ONE profile and REQUIRE `profile_id`. `active_provider` is a
 * selector change only — it never rewrites a profile. `api_key` is write-only:
 * a non-empty value stores it under `profile_id`; `""` deletes only that
 * profile's key.
 */
export interface LlmProviderRequest {
  active_provider?: string;
  fallback_mode?: "auto" | "manual";
  pregen_enabled?: boolean;
  discard_stale_speech_on_regenerated_reply?: boolean;
  profile_id?: string;
  base_url?: string | null;
  model?: string | null;
  preset?: string | null;
  /** "This model sees images" checkbox for a custom model. */
  model_vision?: boolean;
  /** WRITE-ONLY. Never send back a fetched value — there is none to send. */
  api_key?: string;
  /** WRITE-ONLY ACTION (owner amendment 2026-07-24). Names the profile id to
   * REMOVE (config entry + stored key). Mutually exclusive with the
   * profile-scoped edit fields above; MAY combine with an `active_provider`
   * switch in the same PUT (the switch-then-delete ergonomic path). */
  delete_profile?: string | null;
}

export interface ProviderPresetModel {
  id: string;
  /** True when the model accepts images in a chat call. */
  vision: boolean;
}

/** UI-facing provider template. Mirrors opencohost/api/models.py::LlmProviderPresetOut. */
export interface ProviderPreset {
  label: string;
  base_url: string;
  /** Provider page where the user creates an API key. */
  key_url: string;
  default_model: string;
  /** Recommended models (may be empty: rely on the live list from the key test). */
  models: ProviderPresetModel[];
}

/**
 * Offline fallback for the provider templates. The backend is the authority:
 * `useLlmProviderPresets` fetches GET /api/llm/provider/presets and only falls
 * back to this copy while loading or against an older backend. Static
 * consumers (setup flow, readiness card) read it directly.
 * ponytail: keep in sync manually with opencohost/config/settings.py.
 */
export const LLM_PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    key_url: "https://platform.openai.com/api-keys",
    default_model: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", vision: true },
      { id: "gpt-4o", vision: true },
      { id: "gpt-4.1-mini", vision: true }
    ]
  },
  nvidia_nim: {
    label: "NVIDIA NIM",
    base_url: "https://integrate.api.nvidia.com/v1",
    key_url: "https://build.nvidia.com/settings/api-keys",
    default_model: "meta/llama-3.1-70b-instruct",
    models: [
      { id: "meta/llama-3.1-70b-instruct", vision: false },
      { id: "deepseek-ai/deepseek-r1", vision: false },
      { id: "nvidia/nemotron-3.5-super-vl-120b-a12b", vision: true }
    ]
  },
  gemini: {
    label: "Google Gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    key_url: "https://aistudio.google.com/apikey",
    default_model: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.5-flash-lite", vision: true },
      { id: "gemini-3.8-flash", vision: true }
    ]
  },
  deepseek: {
    label: "DeepSeek",
    base_url: "https://api.deepseek.com",
    key_url: "https://platform.deepseek.com/api_keys",
    default_model: "deepseek-flash",
    models: [
      { id: "deepseek-flash", vision: true },
      { id: "deepseek-v4-pro", vision: false }
    ]
  },
  anthropic: {
    label: "Anthropic Claude",
    base_url: "https://api.anthropic.com/v1/",
    key_url: "https://platform.claude.com/settings/keys",
    default_model: "claude-haiku-5-5",
    models: [
      { id: "claude-haiku-5-5", vision: true },
      { id: "claude-sonnet-5-5", vision: true }
    ]
  },
  openrouter: {
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    key_url: "https://openrouter.ai/keys",
    default_model: "",
    models: []
  }
};

/** Backend rule mirrored client-side (design: `[a-z0-9_]+`, `local` reserved).
 * The backend 422 stays the authority — this only drives an inline hint. */
export function isValidProfileId(id: string): boolean {
  return id !== "local" && /^[a-z0-9_]+$/.test(id);
}

/** Sanitize an arbitrary label into a VALID profile id (design: `[a-z0-9_]+`):
 * lowercase, every run of invalid chars → one `_`, trimmed of edge `_`. Returns
 * "" when nothing usable survives (caller treats that as "unsuggestable"). Used
 * to auto-suggest a fix next to a disabled "Guardar" — e.g. "z-ai" → "z_ai". */
export function suggestProfileId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Suggest a FREE `<source>_N` id for the "Duplicar" flow (owner wants several
 * profiles from one provider — e.g. multiple NVIDIA with different models). The
 * source id is sanitized first (so a hyphenated source still yields a valid id)
 * then the lowest unused numeric suffix ≥2 is appended. `existingIds` is small
 * (the configured profiles), so the scan terminates quickly. */
export function suggestDuplicateId(sourceId: string, existingIds: string[]): string {
  const base = suggestProfileId(sourceId) || "proveedor";
  const taken = new Set(existingIds);
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Why the direct cloud vision switch can or cannot be used. Mirrors the
 * backend rule (opencohost/core/vision/direct_cloud.py::profile_model_vision). */
export type DirectVisionAvailability = "ok" | "local" | "no_vision";

export function directVisionAvailability(
  provider: LlmProviderResponse | undefined,
  presets: Record<string, ProviderPreset>
): DirectVisionAvailability {
  const active = provider?.active_provider;
  if (!provider || !active || active === "local") return "local";
  const profile = provider.profiles[active];
  if (!profile) return "local";
  if (profile.model_vision === true) return "ok";
  const preset = profile.preset ? presets[profile.preset] : undefined;
  const sees = preset?.models.some((m) => m.id === profile.model && m.vision) ?? false;
  return sees ? "ok" : "no_vision";
}

export const LLM_PROVIDER_QUERY_KEY = ["llm-provider"] as const;
export const LLM_PROVIDER_PRESETS_QUERY_KEY = ["llm-provider-presets"] as const;

async function extractDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body.detail ?? fallback;
  } catch {
    // non-JSON error body — fall back instead of letting res.json() throw.
    return fallback;
  }
}

/**
 * GET /api/llm/provider — open route (design: same tier as /api/obs/config).
 * A 404 means the running backend predates this route (older build) — surfaced
 * as NotFoundError so the card can show the honest "reopen the app" copy rather
 * than a generic failure. Never carries a key (api_key_set only).
 */
export async function getLlmProvider(): Promise<LlmProviderResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/llm/provider`);
  if (res.status === 404) {
    throw new NotFoundError(await extractDetail(res, "llm_provider_route_missing"));
  }
  if (!res.ok) {
    throw new ApiError(`GET /api/llm/provider failed with ${res.status}`, res.status);
  }
  return (await res.json()) as LlmProviderResponse;
}

/**
 * PUT /api/llm/provider (operator token via authFetch). 422 = a validation
 * ladder failure (missing profile_id, invalid id, unknown preset/provider, or
 * activation-time completeness — the detail string names the exact missing
 * field); 503 = key-store or config write failure. The response echoes the
 * full LlmProviderResponse and NEVER a key.
 */
export async function putLlmProvider(body: LlmProviderRequest): Promise<LlmProviderResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/llm/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 422) {
    throw new ValidationError(await extractDetail(res, "invalid provider config"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "provider_config_write_failed"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/llm/provider failed with ${res.status}`, res.status);
  }
  return (await res.json()) as LlmProviderResponse;
}

/**
 * POST /api/llm/provider/probe (cloud_rearm_20260801 WU1/WU2) — fires one
 * immediate cloud probe on demand, side-stepping the locked model selector
 * during an active agenda. `armed:false` (`not_in_fallback`/`no_cloud_profile`)
 * is a benign no-op, not an error — the caller renders it honestly rather than
 * faking a success toast. Mirrors opencohost/api/models.py::LlmProviderProbeResponse.
 */
export interface LlmProviderProbeResponse {
  armed: boolean;
  reason: string | null;
}

/** authFetch/ApiError pattern of postMemoriaPurge (client.ts:490-500) — no
 * body, no special-status branching; any non-2xx (including 503 when the
 * engine method is missing) is a plain ApiError. */
export async function postCloudProbe(): Promise<LlmProviderProbeResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/llm/provider/probe`, { method: "POST" });
  if (!res.ok) {
    throw new ApiError(`POST /api/llm/provider/probe failed with ${res.status}`, res.status);
  }
  return (await res.json()) as LlmProviderProbeResponse;
}

/**
 * Manual "Probar ahora" trigger (StatusRail's fallback chip). meta.event
 * audits the CLICK only — the armed/reason outcome renders straight from
 * `mutation.data` at the call site, never folded into this toast.
 */
export function useTriggerCloudProbe() {
  return useMutation({
    mutationFn: postCloudProbe,
    meta: {
      event: { source: "llm-provider", action: "probe" }
    }
  });
}

export function useLlmProvider() {
  return useQuery({
    queryKey: LLM_PROVIDER_QUERY_KEY,
    queryFn: getLlmProvider
  });
}

/**
 * One mutation for every provider write (activate / posture / profile save /
 * key delete). meta.event toasts the operator action; the PRIVACY CHOKEPOINT is
 * respected — only `active_provider` or `profile_id` (both identifier-shaped)
 * ever ride in `detail`, NEVER `api_key`. Invalidates the models query too,
 * since /api/models reads the active profile's model list.
 */
export function useUpdateLlmProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putLlmProvider,
    meta: {
      event: (v) => {
        const body = v as LlmProviderRequest;
        // Delete action — checked FIRST so the switch-then-delete ergonomic PUT
        // ({active_provider:"local", delete_profile}) reads as the operator's
        // real intent (a delete), not an "activate → Local". detail = id only.
        if (body.delete_profile !== undefined && body.delete_profile !== null) {
          return { source: "llm-provider", action: "delete", detail: body.delete_profile };
        }
        // Selector-only switch (no profile edit in the same PUT).
        if (body.active_provider !== undefined && body.profile_id === undefined) {
          return {
            source: "llm-provider",
            action: "activate",
            detail: body.active_provider === "local" ? "Local" : body.active_provider
          };
        }
        // Profile-scoped write (save / key delete). detail = id only, never key.
        if (body.profile_id !== undefined) {
          return { source: "llm-provider", action: "profile", detail: body.profile_id };
        }
        // Global posture only (fallback_mode / pregen_enabled).
        return { source: "llm-provider", action: "posture" };
      }
    },
    onSuccess: (data) => {
      // PUT returns the full state — write it straight in (no key present) and
      // refresh the model catalog, which follows the active profile.
      queryClient.setQueryData(LLM_PROVIDER_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
    },
    onSettled: (_data, _error, variables) => {
      // F1: `variables` here is the SAME object TanStack retains as
      // mutation.state.variables (no cloning between mutate()/execute()) —
      // deleting api_key on it in place scrubs the secret from the retained
      // MutationCache entry, not just a copy.
      if ("api_key" in variables) delete variables.api_key;
    }
  });
}

/** GET /api/llm/provider/presets — provider templates (open route, no secrets). */
export async function getLlmProviderPresets(): Promise<Record<string, ProviderPreset>> {
  const res = await fetch(`${getApiBaseUrl()}/api/llm/provider/presets`);
  if (!res.ok) {
    throw new ApiError(`GET /api/llm/provider/presets failed with ${res.status}`, res.status);
  }
  return ((await res.json()) as { presets: Record<string, ProviderPreset> }).presets;
}

/** Presets from the backend, falling back to the static copy while loading or
 * against an older backend that lacks the route. */
export function useLlmProviderPresets(): Record<string, ProviderPreset> {
  const { data } = useQuery({
    queryKey: LLM_PROVIDER_PRESETS_QUERY_KEY,
    queryFn: getLlmProviderPresets,
    staleTime: Infinity,
    retry: false
  });
  return data ?? LLM_PROVIDER_PRESETS;
}

/** POST /api/llm/provider/test body. `api_key` is WRITE-ONLY; omit it to test
 * the key stored for `profile_id`. */
export interface LlmProviderTestRequest {
  preset?: string;
  base_url?: string;
  api_key?: string;
  profile_id?: string;
  /** Also send ONE tiny chat completion to `model` (spends a few tokens). */
  check_chat?: boolean;
  model?: string;
}

export type LlmProviderChatErrorCode =
  | "cloud_auth"
  | "cloud_rate_limit"
  | "cloud_bad_request"
  | "timeout"
  | "cloud_error";

export type LlmProviderTestErrorCode =
  | "invalid_key"
  | "unreachable"
  | "rate_limited"
  | "unexpected"
  | "key_reentry_required"
  | "insecure_base_url";

/** Mirrors opencohost/api/models.py::LlmProviderTestResponse. Never carries a key. */
export interface LlmProviderTestResponse {
  ok: boolean;
  error_code: LlmProviderTestErrorCode | null;
  models: string[];
  recommended: string[];
  /** Stage 1 (GET /models) result; equals `ok`. */
  models_ok?: boolean;
  /** Stage 2 (one tiny chat completion): null/absent when it did not run. */
  chat_ok?: boolean | null;
  chat_error_code?: LlmProviderChatErrorCode | null;
  http_status?: number | null;
  /** Sanitized provider text of the failing stage; never carries the key. */
  provider_message?: string | null;
}

export async function postLlmProviderTest(body: LlmProviderTestRequest): Promise<LlmProviderTestResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/llm/provider/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`POST /api/llm/provider/test failed with ${res.status}`, res.status);
  }
  return (await res.json()) as LlmProviderTestResponse;
}

/** Key test mutation. No meta.event: the result renders inline, and nothing
 * secret may reach the feed. Like the PUT, it scrubs `api_key` off the
 * variables TanStack retains after settle. */
export function useTestLlmProvider() {
  return useMutation({
    mutationFn: postLlmProviderTest,
    onSettled: (_data, _error, variables) => {
      if ("api_key" in variables) delete variables.api_key;
    }
  });
}
