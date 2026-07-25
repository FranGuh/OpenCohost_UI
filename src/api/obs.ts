import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * GET/PUT /api/obs/config + POST /api/obs/test (opencohost/api/main.py
 * ~678-712) predate types.gen.ts's OpenAPI generation, so they have no
 * generated type — hand-typed from opencohost/api/models.py::
 * ObsConfigResponse/ObsConfigRequest/ObsTestResponse. R8/secret:
 * `password_set` is a bool only, the real password is never echoed back.
 *
 * SECRET (F1, same leak as llmProvider.ts's api_key): TanStack retains
 * `mutation.state.variables` (the request body) on the MutationCache for
 * ~gcTime after settle — both mutations below scrub `password` off that
 * retained object in place in `onSettled` so it doesn't linger there either.
 * ponytail: keep in sync manually if those models change.
 */
export interface ObsConfigResponse {
  enabled: boolean;
  host: string;
  port: number;
  source: string;
  password_set: boolean;
}

/** PUT body — partial update. `password` omitted leaves the stored value
 * untouched (never send an empty string to "clear" it — omit the field). */
export interface ObsConfigRequest {
  enabled?: boolean;
  host?: string;
  port?: number;
  source?: string;
  password?: string;
}

export interface ObsTestResponse {
  ok: boolean;
  error: string | null;
}

export const OBS_CONFIG_QUERY_KEY = ["obs-config"] as const;

export async function getObsConfig(): Promise<ObsConfigResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/obs/config`);
  if (!res.ok) {
    throw new ApiError(`GET /api/obs/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ObsConfigResponse;
}

export async function putObsConfig(body: ObsConfigRequest): Promise<ObsConfigResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/obs/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 422) {
    let detail = "invalid obs config";
    try {
      const errBody = (await res.json()) as { detail?: string };
      detail = errBody.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/obs/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ObsConfigResponse;
}

export async function postObsTest(body: ObsConfigRequest): Promise<ObsTestResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/obs/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`POST /api/obs/test failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ObsTestResponse;
}

export function useObsConfigQuery() {
  return useQuery({
    queryKey: OBS_CONFIG_QUERY_KEY,
    queryFn: getObsConfig
  });
}

export function useUpdateObsConfigMutation() {
  const queryClient = useQueryClient();
  // ObsCard's save() always sends `enabled` (it's the current switch state, not
  // a "did the user touch this" flag), so `body.enabled !== undefined` alone
  // can't tell a toggle from a host/port/source-only edit. Snapshot the
  // pre-mutation `enabled` in onMutate (before the PUT lands and onSuccess
  // overwrites the cache) so meta.event can diff against it instead. A ref
  // survives react-query re-binding options to a fresh render's closures.
  const previousEnabled = useRef<boolean | undefined>(undefined);
  return useMutation({
    mutationFn: putObsConfig,
    onMutate: () => {
      previousEnabled.current = queryClient.getQueryData<ObsConfigResponse>(OBS_CONFIG_QUERY_KEY)?.enabled;
    },
    meta: {
      event: (v) => {
        const body = v as ObsConfigRequest;
        if (body.enabled !== undefined && body.enabled !== previousEnabled.current) {
          return { source: "obs", action: "toggle", detail: body.enabled ? "on" : "off" };
        }
        return { source: "obs", action: "config", detail: body.source }; // scene/source NAME only; never password
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(OBS_CONFIG_QUERY_KEY, data);
    },
    onSettled: (_data, _error, variables) => {
      // F1 (mirrors useUpdateLlmProvider's api_key scrub): `variables` here is
      // the SAME object TanStack retains as mutation.state.variables — deleting
      // password on it in place scrubs the secret from the retained
      // MutationCache entry, not just a copy.
      if ("password" in variables) delete variables.password;
    }
  });
}

export function useTestObsConnectionMutation() {
  return useMutation({
    mutationFn: postObsTest,
    onSettled: (_data, _error, variables) => {
      // Same F1 leak, same fix: "Probar conexión" sends the same password field.
      if ("password" in variables) delete variables.password;
    }
  });
}
