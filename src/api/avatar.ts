import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * GET/PUT /api/avatar/config (opencohost/api/main.py ~705-729) predates
 * types.gen.ts's OpenAPI generation, so it has no generated type — hand-typed
 * from opencohost/api/models.py::AvatarConfigResponse/AvatarConfigRequest.
 * `state_images` is a plain path map (no upload endpoint exists yet).
 * ponytail: keep in sync manually if those models change.
 */
export interface AvatarConfigResponse {
  enabled: boolean;
  mode: string;
  assets_folder: string;
  state_images: Record<string, string>;
}

export type AvatarConfigRequest = Partial<Omit<AvatarConfigResponse, "assets_folder">>;

export const AVATAR_CONFIG_QUERY_KEY = ["avatar-config"] as const;

export async function getAvatarConfig(): Promise<AvatarConfigResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/avatar/config`);
  if (!res.ok) {
    throw new ApiError(`GET /api/avatar/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as AvatarConfigResponse;
}

export async function putAvatarConfig(body: AvatarConfigRequest): Promise<AvatarConfigResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/avatar/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 422) {
    let detail = "invalid avatar config";
    try {
      const errBody = (await res.json()) as { detail?: string };
      detail = errBody.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/avatar/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as AvatarConfigResponse;
}

export function useAvatarConfigQuery() {
  return useQuery({
    queryKey: AVATAR_CONFIG_QUERY_KEY,
    queryFn: getAvatarConfig
  });
}

export function useUpdateAvatarConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putAvatarConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(AVATAR_CONFIG_QUERY_KEY, data);
    }
  });
}
