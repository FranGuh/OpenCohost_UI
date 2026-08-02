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
  /** True when a key is stored for THIS profile id (OAuthStore). The key
   * itself is never returned — this bool is the only signal. */
  api_key_set: boolean;
}

export interface LlmProviderResponse {
  /** "local" (Ollama) or a configured profile id. */
  active_provider: string;
  fallback_mode: "auto" | "manual";
  pregen_enabled: boolean;
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
  profile_id?: string;
  base_url?: string | null;
  model?: string | null;
  preset?: string | null;
  /** WRITE-ONLY. Never send back a fetched value — there is none to send. */
  api_key?: string;
  /** WRITE-ONLY ACTION (owner amendment 2026-07-24). Names the profile id to
   * REMOVE (config entry + stored key). Mutually exclusive with the
   * profile-scoped edit fields above; MAY combine with an `active_provider`
   * switch in the same PUT (the switch-then-delete ergonomic path). */
  delete_profile?: string | null;
}

/**
 * Client mirror of opencohost/config/settings.py::LLM_PROVIDER_PRESETS — used
 * only to prefill `base_url` and label the built-in providers in the UI. The
 * backend is the authority (an unknown preset 422s); this is a convenience
 * copy, not a source of truth. ponytail: keep in sync manually.
 */
export const LLM_PROVIDER_PRESETS: Record<string, { label: string; base_url: string }> = {
  openai: { label: "OpenAI", base_url: "https://api.openai.com/v1" },
  nvidia_nim: { label: "NVIDIA NIM", base_url: "https://integrate.api.nvidia.com/v1" }
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

export const LLM_PROVIDER_QUERY_KEY = ["llm-provider"] as const;

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
